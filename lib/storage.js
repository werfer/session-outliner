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

const {
    assert,
    handleException
} = require("utils");

const {
    indexedDB, IDBKeyRange
} = require("sdk/indexed-db");

const {
    SessionNode
} = require("tabmodel");

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
    let _model = model;
    let _rootNode = model.getRootNode();
    let _db;

    let init = function() {
        open();
    };

    let dispose = function(node) {
        detach();

        if (_db) {
            _db.close();
        }
    };

    let attach = function() {
        //[ event handlers
        _model.on("modelReset",    onModelReset);
        _model.on("nodeChanged",   onModelNodeChanged);
        _model.on("nodeReplaced",  onModelNodeReplaced);
        _model.on("nodeMoved",     onModelNodeMoved);
        _model.on("nodeRemoved",   onModelNodeRemoved);
        _model.on("nodeInserted",  onModelNodeInserted);
        _model.on("nodesSwapped",  onModelNodesSwapped);
        //]
    };
    
    let detach = function() {
        _model.removeAllListeners();
    };

    // ****************************************************************************
    // TabModel event handlers:

    function onModelReset(event) {
        let modelRootNode = _model.getRootNode();
        if (_rootNode !== modelRootNode) {
            saveSnapshot();
            _rootNode = modelRootNode;
        }
    };

    function onModelNodeChanged(event, node) {
        let tx = startTransaction(DB_STORE_NAME, "readwrite");
        saveBranch(tx, node);
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

    let errorHandler = function(e) {
        console.error("IDBStorageBackend: " + evt.value);
    };

    let open = function() {
        let request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onsuccess = function(evt) {
            _db = this.result;

            readSnapshot();
            attach();
        };

        request.onerror = errorHandler;

        request.onupgradeneeded = function(evt) {
            let db = evt.target.result;
            evt.target.transaction.onerror = errorHandler;

            if (db.objectStoreNames.contains(DB_STORE_NAME)) {
                db.deleteObjectStore(DB_STORE_NAME);
            }

            let store = db.createObjectStore(DB_STORE_NAME, {
                keyPath: "node.id"
            });
        };
    };

    let startTransaction = function(storeName, mode) {
        let tx = _db.transaction(storeName, mode);

        tx.onerror = errorHandler;
        tx.oncomplete = function(evt) {
//            console.log("IDBStorageBackend: Transaction complete.");
        };

        return tx;
    };

    let saveBranch = function(tx, node) {
        //[ update tree structure
        let parentNode = node.getParent();
        if (parentNode) {
            updateStructure(tx, parentNode);
        }
        //]

        let store = tx.objectStore(DB_STORE_NAME);

        //[ save node including its children
        let nodes = _model.matchNodes(everything, { containerNode: node });
        for (let i = 0, len = nodes.length; i < len; ++i) {
            let currentNode = nodes[i];
            let currentId   = currentNode.getId();

            let serialized = currentNode.serialize();
            let children   = getChildIds(currentNode);

            let request = store.put({
                "children": children,
                "node": serialized
            });

            request.onerror = errorHandler;
        }
        //]
    };

    let deleteBranch = function(tx, index, ids) {
        //[ update tree structure
        if (index.isRoot()) {
            return;
        }

        let parentNode = _model.getNode(index.getParent());
        assert(parentNode, "Parent Node not found.");
        updateStructure(tx, parentNode);
        //]

        let store = tx.objectStore(DB_STORE_NAME);

        //[ delete nodes
        for (let i = 0, len = ids.length; i < len; ++i) {
            let id = ids[i];
            let request = store.delete(id);

            request.onerror = errorHandler;
        }
        //]
    };

    let updateStructure = function(tx, node) {
        let store = tx.objectStore(DB_STORE_NAME);
        let keyRange = IDBKeyRange.only(node.getId());
        let cursor = store.openCursor(keyRange);

        let children = getChildIds(node);

        cursor.onerror = errorHandler;
        cursor.onsuccess = function (e) {
            let result = e.target.result;
            if (!!result == false) {
                return;
            }

            // set the new id array
            result.value.children = children;
            let request = result.update(result.value);

            request.onerror = errorHandler;
        };
    };

    let saveSnapshot = function() {
        let tx = startTransaction(DB_STORE_NAME, "readwrite");
        let store = tx.objectStore(DB_STORE_NAME);

        //[ clear store
        let request = store.clear();

        request.onerror = errorHandler;
        request.onsuccess = function(evt) {
            let rootNode = _model.getRootNode();
            saveBranch(tx, rootNode);
        };
        //]
    };

    let readSnapshot = function() {
        let tx = startTransaction(DB_STORE_NAME, "readonly");
        let store = tx.objectStore(DB_STORE_NAME);

        let serializedNodes = [];

        let keyRange = IDBKeyRange.lowerBound(0);
        let cursor = store.openCursor(keyRange);

        cursor.onerror = errorHandler;
        cursor.onsuccess = function(e) {
            let result = e.target.result;
            if (!!result == false) { // no more results
                activateSession(serializedNodes);
                return;
            }

            let currentId = result.value.node.id;
            serializedNodes[currentId] = result.value;
            result.continue();
        };
    };

    let composeTree = function(serializedNodes) {
        let nodes = [];
        let rootNode;

        //[ deserialize nodes
        serializedNodes.forEach(function(value, index, array) {
            let currentNode  = _model.deserializeNode(value.node);
            let currentId    = currentNode.getId();
            nodes[currentId] = currentNode;
        });
        //]

        //[ restore tree structure
        nodes.forEach(function(currentNode, index, array) {
            let children = serializedNodes[index].children;

            children.forEach(function(childId) {
                if (!(childId in nodes)) {
                    console.error("Missing node with id: " + childId);
                    throw new Error("Database corruption.");
                }

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
        try {
            if (serializedNodes.length >= 1) {
                let rootNode = composeTree(serializedNodes);
                assert(rootNode, "Root node not found.");
                _rootNode = rootNode;

                // activate the saved session
                _model.reset(rootNode);
                return;
            }
        } catch (e) {
            handleException(e);
            console.error("Could not deserialize Session; Database corruption.");
        }

        // the database is empty or corrupted; initialize it with our current session
        saveSnapshot();
    };

    return {
        init: init,
        dispose: dispose
    };
};
module.exports.IDBStorageBackend = IDBStorageBackend;
