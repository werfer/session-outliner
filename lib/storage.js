// Session Outliner
// Copyright (C) 2014, Josef Schmeißer
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

"use strict";

const { defer } = require('sdk/core/promise');

const {
    indexedDB,
    IDBKeyRange
} = require("sdk/indexed-db");

const { alert } = require("./browser");
const { SessionNode} = require("./tabmodel");

const {
    assert,
    isEmpty
} = require("./utils");

// ****************************************************************************

function getNodeId(node) {
    return node.getId();
}

function everything() {
    return true;
}

function getChildIds(node) {
    let children;

    // collect ids
    if (node.isContainer() && node.hasChildren()) {
        children = node.getChildren().map(getNodeId);
    } else {
        children = [];
    }

    return children;
}

// ****************************************************************************
// IDBStorageBackend implementation:

const DB_NAME = "session_store";
const DB_VERSION = 1;
const DB_STORE_NAME = "nodes";

const IDBStorageBackend = function(model) {
    let mModel = model;
    let mRootNode = model.getRootNode();
    let mAttached;
    let mDb;

    let init = function() {
        mAttached = false;

        openDatabase().
            then(readSnapshot, dbErrorHandler).
            then(function success(nodes) {
                if (isEmpty(nodes)) {
                    // the database is empty
                    console.log("Empty database.");
                    saveSnapshot();
                    attach();
                    return;
                }

                if (!validateStructure(nodes)) {
                    console.error("Validation failed.");
                    alert("Sesssion Outliner - IDBStorageBackend", "The database is corrupted.");
                    return;
                }

                // attach the event listeners
                attach();

                // add all nodes to our current model
                activateSession(nodes);
                console.log("Session activated");
            }, dbErrorHandler);
    };

    let dispose = function(node) {
        detach();

        if (mDb) {
            mDb.close();
        }
    };

    let attach = function() {
        //[ event handlers
        mModel.on("modelReset",    onModelReset);
        mModel.on("nodeChanged",   onModelNodeChanged);
        mModel.on("nodeReplaced",  onModelNodeReplaced);
        mModel.on("nodeMoved",     onModelNodeMoved);
        mModel.on("nodeRemoved",   onModelNodeRemoved);
        mModel.on("nodeInserted",  onModelNodeInserted);
        mModel.on("nodesSwapped",  onModelNodesSwapped);
        //]

        mAttached = true;
    };
    
    let detach = function() {
        mModel.removeAllListeners();
        mAttached = false;
    };

    // ****************************************************************************
    // TabModel event handlers:

    function onModelReset(event) {
        let modelRootNode = mModel.getRootNode();
        if (mRootNode !== modelRootNode) {
            saveSnapshot();
            mRootNode = modelRootNode;
        }
    };

    function onModelNodeChanged(event, node) {
        let tx = startTransaction(DB_STORE_NAME, "readwrite");
        saveNode(tx, node);
    };

    function onModelNodeRemoved(event, index, oldIds) {
        let tx = startTransaction(DB_STORE_NAME, "readwrite");
        deleteBranch(tx, index, oldIds);
    };

    function onModelNodeReplaced(event, newNode, oldIds) {
        let tx = startTransaction(DB_STORE_NAME, "readwrite");
        let index = newNode.getIndex();
        deleteBranch(tx, index, oldIds);
        saveBranch(tx, newNode);
    };

    function onModelNodeMoved(event, node, oldParent, position) {
        let tx = startTransaction(DB_STORE_NAME, "readwrite");
        let newParent = node.getParent();

        if (oldParent === newParent) {
            updateStructure(tx, oldParent);
        } else {
            updateStructure(tx, oldParent);
            updateStructure(tx, newParent);
        }
    };

    function onModelNodeInserted(event, node, parentNode, position) {
        let tx = startTransaction(DB_STORE_NAME, "readwrite");
        saveBranch(tx, node);
    };

    function onModelNodesSwapped(event, node1, node2) {
        let tx = startTransaction(DB_STORE_NAME, "readwrite");
        updateStructure(tx, node1.getParent());
        updateStructure(tx, node2.getParent());
    };

    // ****************************************************************************

    let dbErrorHandler = function(evt) {
        console.error("IDBStorageBackend:", evt);
    };

    let openDatabase = function() {
        let deferred = defer();
        let request  = indexedDB.open(DB_NAME, DB_VERSION);

        request.onsuccess = function(evt) {
            mDb = this.result;
            deferred.resolve(evt);
        };

        request.onerror = function(evt) {
            deferred.reject(evt);
        };

        request.onupgradeneeded = function(evt) {
            let db = evt.target.result;
            evt.target.transaction.onerror = dbErrorHandler;

            if (db.objectStoreNames.contains(DB_STORE_NAME)) {
                db.deleteObjectStore(DB_STORE_NAME);
            }

            let store = db.createObjectStore(DB_STORE_NAME, {
                keyPath: "node.id"
            });
        };

        return deferred.promise;
    };

    let startTransaction = function(storeName, mode) {
        let tx = mDb.transaction(storeName, mode);
        tx.onerror = dbErrorHandler;
        return tx;
    };

    let saveNode = function(tx, node) {
        let serialized = node.serialize();
        let children   = getChildIds(node);

        let store = tx.objectStore(DB_STORE_NAME);
        let request = store.put({
            "children": children,
            "node": serialized
        });

        request.onerror = dbErrorHandler;
    };

    let saveBranch = function(tx, node) {
        //[ update tree structure
        let parentNode = node.getParent();
        if (parentNode) {
            updateStructure(tx, parentNode);
        }
        //]

        // save node including its children
        mModel.traverseAll(function(currentNode) {
            saveNode(tx, currentNode);
        }, node);
    };

    let deleteBranch = function(tx, index, ids) {
        //[ update tree structure
        if (index.isRoot()) {
            throw new Error("Attempt to delete SessionNode.");
        }

        let parentNode = mModel.getNode(index.getParent());
        assert(parentNode, "Parent Node not found.");
        updateStructure(tx, parentNode);
        //]

        let store = tx.objectStore(DB_STORE_NAME);

        //[ delete nodes
        for (let i = 0, len = ids.length; i < len; ++i) {
            let id = ids[i];
            let request = store.delete(id);

            request.onerror = dbErrorHandler;
        }
        //]
    };

    let updateStructure = function(tx, node) {
        let store = tx.objectStore(DB_STORE_NAME);
        let keyRange = IDBKeyRange.only(node.getId());
        let cursor = store.openCursor(keyRange);

        let children = getChildIds(node);

        cursor.onerror = dbErrorHandler;
        cursor.onsuccess = function (e) {
            let result = e.target.result;
            if (!!result == false) {
                return;
            }

            // set the new id array
            result.value.children = children;
            let request = result.update(result.value);

            request.onerror = dbErrorHandler;
        };
    };

    let saveSnapshot = function() {
        let tx = startTransaction(DB_STORE_NAME, "readwrite");
        let store = tx.objectStore(DB_STORE_NAME);

        //[ clear store
        let request = store.clear();

        request.onerror = dbErrorHandler;
        request.onsuccess = function(evt) {
            let rootNode = mModel.getRootNode();
            saveBranch(tx, rootNode);
        };
        //]
    };

    let readSnapshot = function() {
        let deferred = defer();
        let tx = startTransaction(DB_STORE_NAME, "readonly");
        let store = tx.objectStore(DB_STORE_NAME);

        let serializedNodes = [];

        let keyRange = IDBKeyRange.lowerBound(0);
        let cursor = store.openCursor(keyRange);

        cursor.onerror = function(evt) {
            deferred.reject(evt);
        };

        cursor.onsuccess = function(e) {
            let result = e.target.result;
            if (!!result == false) {
                // no more results
                deferred.resolve(serializedNodes);
            } else {
                let currentId = result.value.node.id;
                serializedNodes[currentId] = result.value;
                result.continue();
            }
        };

        return deferred.promise;
    };

    let validateStructure = function(serializedNodes) {
        console.log("=== Start database validation. ===");

        if (isEmpty(serializedNodes)) {
            console.log("Empty session.");
            return false;
        }

        let errorCount = 0;
        let nodeInfo   = []; // sparse array; node id = index
        let relations  = []; // array of id arrays

        serializedNodes.forEach(function(value, index, array) {
            let currentId = value.node.id;
            nodeInfo[currentId] = {
                data: value.node,
                references: 0
            };

            relations.push(value.children);
        });

        // flatten id array
        let referencedIds = relations.reduce(function(a, b) {
            return a.concat(b);
        });

        referencedIds.sort(function(a, b) {
            return a - b;
        });
        console.log("References:", referencedIds);

        referencedIds.forEach(function(value, index, array) {
            if (value in nodeInfo) {
                nodeInfo[value].references++;
            } else {
                console.error("Missing node with id:", value);
                errorCount++;
            }
        });

        let foundSessionNode = false;

        nodeInfo.forEach(function(value, index, array) {
            let node = value.data;

            if (node.typename == "SessionNode") {
                foundSessionNode = true;
            }

            if (value.references != 1 && node.typename != "SessionNode") {
                console.error("Found incorrect number of references (" +
                              value.references + ") to the following node:", node);
                errorCount++;
            } else if (value.references != 0 && node.typename == "SessionNode") {
                console.error("There should be no reference(s) to the Session Node.");
                errorCount++;
            }
        });

        if (!foundSessionNode) {
            errorCount++;
        }

        console.log("=== Validation finished with " + errorCount + " error(s) ===");

        return (errorCount == 0);
    };

    let composeTree = function(serializedNodes) {
        let nodes = [];
        let rootNode;

        //[ deserialize nodes
        serializedNodes.forEach(function(value, index, array) {
            let currentNode  = mModel.deserializeNode(value.node);
            let currentId    = currentNode.getId();
            nodes[currentId] = currentNode;
        });
        //]

        //[ restore tree structure
        nodes.forEach(function(currentNode, index, array) {
            let children = serializedNodes[index].children;

            children.forEach(function(childId) {
                let childNode = nodes[childId];
                currentNode._appendChild(childNode);
            });

            if (currentNode instanceof SessionNode) {
                rootNode = currentNode;
            }
        });
        //]

        return rootNode;
    };

    let activateSession = function(serializedNodes) {
        assert(!isEmpty(serializedNodes), "Empty array.");

        let rootNode = composeTree(serializedNodes);
        assert(rootNode, "Root node not found.");
        mRootNode = rootNode;

        // activate the saved session
        mModel.reset(rootNode);
    };

    return {
        init: init,
        dispose: dispose
    };
};
module.exports.IDBStorageBackend = IDBStorageBackend;
