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

const { Class } = require("classy/classy");
const { EventEmitter } = require("event");

const {
    assert,
    handleException,
    isEmpty,
    InvalidOperationError
} = require("utils");

const Position = {
    BEFORE: 0,
    AFTER:  1,
    INSIDE: 2
};
module.exports.Position = Position;

const Traverse = {
    TERMINATE:     0,
    CONTINUE:      1,
    SKIP_CHILDREN: 2
};
module.exports.Traverse = Traverse;

const INVALID_ID = 0;

let ModelIndex = function(path, model) {
    assert(Array.isArray(path), "Expected an array as path argument.");

    let _path = path; // array of indices
    let _model = model;

    return {
        getPath: function() {
            return _path.slice(0);
        },

        getParent: function() {
            return ModelIndex(_path.slice(0, -1), _model);
        },

        getParentPath: function() {
            return _path.slice(0, -1);
        },

        getPosition: function() {
            return _path[_path.length - 1];
        },

        belongsTo: function(model) {
            return model === _model;
        },

        isRoot: function() {
            return _path.length == 0;
        },

        toString: function() {
            let str = "root";
            for (let i = 0, len = _path.length; i < len; ++i) {
                str += " -> " + _path[i];
            }

            return str;
        },
        
        valueOf: function() {
            return _path.slice(0);
        }
    };
};
module.exports.ModelIndex = ModelIndex;

let AbstractNode = Class.$extend({
    __classvars__ : {
        SERIALIZABLE: []
    },

    __init__: function(config) {
        config || (config = { });
        let data = config.data || { };

        let property;
        let prototype = Object.getPrototypeOf(this);
        let serializable = prototype.__classvars__.SERIALIZABLE;

        for (let i = 0, len = serializable.length; i < len; ++i) {
            property = serializable[i];

            if (property in data) {
                this[property] = data[property]
            }
        }

        if (config.hasOwnProperty("id")) {
            this._id = config["id"];
        } else {
            this._id = INVALID_ID;
        }

        this._model = undefined;
        this._parentNode = undefined;
    },

    _setParent: function(node) {
        this._parentNode = node;
        
        // same model as parent
        if (node) {
            this._model = node._model;
        }
    },

    _setModel: function(model) {
        this._model = model;
    },

    _setId: function(id) {
        this._id = id;
    },

    getId: function() {
        return this._id;
    },

    getIndex: function() {
        let path = (function composePath(node) {
            let parent = node.getParent();
            assert(parent !== node, "Cyclic reference.");

            if (parent) {
                let subPath = composePath(parent);
                subPath.push(parent.getPosition(node))
                return subPath;
            } else {
                return []; // root node
            }
        })(this);

        return ModelIndex(path, this._model);
    },

    getParent: function() {
        return this._parentNode;
    },

    getModel: function() {
        return this._model;
    },

    isContainer: function() {
        return false;
    },

    isIdValid: function() {
        return (this._id != INVALID_ID);
    },

    serialize: function() {
        let property;
        let serializable = this.$class.SERIALIZABLE;
        let obj = {
            id: this._id,
            typename: this.typename()
        };

        let data = { };
        for (let i = 0, len = serializable.length; i < len; ++i) {
            property = serializable[i];

            if (property in this) {
                data[property] = this[property]
            }
        }

        if (!isEmpty(data)) {
            obj["data"] = data;
        }

        return obj;
    },

    typename: function() {
        return "AbstractNode";
    },
    
    toString: function() {
        return "[AbstractNode]";
    }
});
module.exports.AbstractNode = AbstractNode;

let AbstractGroupNode = AbstractNode.$extend({
    /**
     * @param {config} optional
     */
    __init__: function(config) {
        config || (config = {});
        let children = config.children || [];
        let that = this;

        //[ adopt children
        this._children = children.slice(0);
        this.forEach(function(node) {
            node._setParent(that);
        });
        //]

        this.$super(config);
    },

    _appendChild: function(node) {
        this._children.push(node);
        node._setParent(this);

        return this;
    },

    _takeChild: function(position) {
        let child = this._children[position];
        this._children.splice(position, 1);

        return child;
    },

    _insertChild: function(node, position) {
        this._children.splice(position, 0, node);
        node._setParent(this);

        return this;
    },

    _replaceChild: function(newNode, position) {
        let oldNode = this._children[position];

        this._children[position] = newNode;
        oldNode._setParent(undefined);
        newNode._setParent(this);

        return this;
    },

    _iterate: function(callback) {
        if (typeof callback !== "function") {
            throw new TypeError("Expected a function as argument.");
        }

        for (let i = 0, len = this._children.length; i < len; ++i) {
            let node = this._children[i];
            try {
                // only continue if the callback returns true
                if (!callback(node)) return node;
            } catch (e) {
                handleException(e);
            }
        }

        return null;
    },

    _reverse_iterate: function(callback) {
        if (typeof callback !== "function") {
            throw new TypeError("Expected a function as argument.");
        }

        for (let i = this._children.length; i-- > 0;) {
            let node = this._children[i];
            try {
                // only continue if the callback returns true
                if (!callback(node)) return node;
            } catch (e) {
                handleException(e);
            }
        }

        return null;
    },

    _findNode: function(iterator, predicate) {
        let result = null;
        let searchPred = function(node) {
            if (predicate(node)) {
                result = node;
                return false; // stop recursion
            }

            return true; // continue
        }

        iterator.call(this, searchPred);
        return result;
    },

    forEach: function(callback) {
        this._iterate(function(node) {
            callback(node);
            return true; // always continue
        });

        return this;
    },

    findFirstNode: function(predicate) {
        return this._findNode(this._iterate, predicate);
    },

    findLastNode: function(predicate) {
        return this._findNode(this._reverse_iterate, predicate);
    },

    front: function() {
        assert(this.hasChildren(), "Empty node.");
        return this.getChild(0);
    },

    back: function() {
        assert(this.hasChildren(), "Empty node.");
        return this.getChild(this._children.length - 1);
    },

    matchNodes: function(predicate) {
        let results = [];
        let searchPred = function(node) {
            if (predicate(node)) {
                results.push(node);
            }

            return true; // continue
        }

        this._iterate(searchPred);
        return results;
    },

    hasNode: function(node) {
        return (this._children.indexOf(node) != -1);
    },

    hasChildren: function(node) {
        return (this._children.length > 0);
    },

    getChild: function(position) {
        return this._children[position];
    },

    getChildren: function() {
        return this._children.slice();
    },
    
    getChildCount: function() {
        return this._children.length;
    },

    getPosition: function(node) {
        return this._children.indexOf(node);
    },

    isContainer: function() {
        return true;
    },

    typename: function() {
        return "AbstractGroupNode";
    },

    toString: function() {
        return "[AbstractGroupNode | children: " + this._children.length + "]";
    }
});
module.exports.AbstractGroupNode = AbstractGroupNode;

let TreeModel = EventEmitter.$extend({
    __init__: function(rootNode) {
        this.$super();

        this._idmap = [null];
        this._rootNode = rootNode;
        this._adoptNode(rootNode);
    },

    _aquireId: function() {
        let len = this._idmap.length;

        // skip the first id
        for (let id = 1; id < len; ++id) {
            if (!(id in this._idmap)) {
                return id;
            }
        }

        return len;
    },

    _releaseId: function(id) {
        delete this._idmap[id];
    },

    _clearIdMap: function() {
        this._idmap.length = 0;
        this._idmap.push(null);
    },

    _adoptNode: function(node) {
        let that = this;

        this.traverseAll(function(currentNode) {
            let id;
            if (currentNode.isIdValid()) {
                id = currentNode.getId();
                if (id in that._idmap) {
                    throw new Error("Id is already in use.");
                }
            } else {
                id = that._aquireId();
                currentNode._setId(id);
            }

            that._idmap[id] = currentNode;
            currentNode._setModel(that);
        }, node);
    },

    _releaseNode: function(node) {
        let that = this;

        this.traverseAll(function(currentNode) {
            let id = currentNode.getId();

            currentNode._setModel(undefined);
            currentNode._setId(INVALID_ID);

            that._releaseId(id);
        }, node);
    },

    _collectIds: function(node) {
        let ids = [];

        this.traverseAll(function(currentNode) {
            ids.push(currentNode.getId());
        }, node);

        return ids;
    },

    hasId: function(id) {
        return (id in this._idmap);
    },

    getNode: function(index) {
        assert(index.belongsTo(this), "The Index doesn't belong to this Model.");

        let path = index.getPath();
        if (path.length == 0) {
            return this._rootNode;
        }

        let node = (function searchNode(currentPath, parentNode) {
            let currentNode = parentNode.getChild(currentPath[0]);
            if (currentPath.length == 1) {
                return currentNode;
            } else {
                return searchNode(currentPath.slice(1), currentNode);
            }
        })(path, this._rootNode);

        return node;
    },

    getNodeById: function(id) {
        assert(id in this._idmap, "Unknown id.");
        return this._idmap[id];
    },

    getRootNode: function() {
        return this._rootNode;
    },

    /**
     * traversal is depth-first
     */
    /*
    traverse: function(callback, opt)
    opt { containerNode, skipNodePredicate }
    */
    traverse: function(callback, opt) {
        opt || (opt = { });

        if (typeof callback !== "function") {
            throw new TypeError("Expected a function as argument.");
        }

        let containerNode = opt.containerNode || this._rootNode;
        let skipNodePredicate = opt.skipNodePredicate || null;

        // recursive tree walker
        let traverseNode = function(currentNode) {
            //[ skip node?
            if (skipNodePredicate && skipNodePredicate(currentNode)) {
                return Traverse.CONTINUE;
            }
            //]

            let result;
            try {
                result = callback(currentNode);
                if (result != Traverse.CONTINUE) {
                    return result;
                }
            } catch (e) {
                handleException(e);
            }

            // start new recursion?
            if (currentNode.isContainer() && currentNode.hasChildren()) {
                let children = currentNode._children;

                for (let i = 0, len = children.length; i < len; ++i) {
                    result = traverseNode(children[i]);
                    if (result == Traverse.TERMINATE) {
                        return result; // stop recursion
                    }
                }
            }

            return Traverse.CONTINUE;
        };
        traverseNode(containerNode);

        return this;
    },

    traverseAll: function(callback, containerNode) {
        this.traverse(function(currentNode) {
            callback(currentNode);
            return Traverse.CONTINUE; // always continue
        }, { containerNode: containerNode || this._rootNode } );
    },

    countSubNodes: function(node) {
        let count = -1; // the starting node will also be visited

        this.traverse(function(currentNode) {
            count++;
            return Traverse.CONTINUE;
        }, { containerNode: node } );

        return count;
    },

    findFirstNode: function(predicate, opt) {
        let result = null;
        let search = function(currentNode) {
            if (predicate(currentNode)) {
                result = currentNode;
                return Traverse.TERMINATE; // stop recursion
            }

            return Traverse.CONTINUE;
        }

        this.traverse(search, opt);
        return result;
    },

    findLastNode: function(predicate, opt) {
        let result = null;
        let previousNodes = [];

        this.traverse(function(currentNode) {
            // nodes will be in reverse order
            previousNodes.unshift(currentNode);
            return Traverse.CONTINUE;
        }, opt);

        for (let i = 0, len = previousNodes.length; i < len; ++i) {
            let currentNode = previousNodes[i];

            if (predicate(currentNode)) {
                return currentNode;
            }
        }

        return result;
    },

    matchNodes: function(predicate, opt) {
        let results = [];
        let search = function(node) {
            if (predicate(node)) {
                results.push(node);
            }

            return Traverse.CONTINUE; // continue
        }

        this.traverse(search, opt);
        return results;
    },

    nextSibling: function(node, predicate, opt) {
        let found = false;
        let sibling = null;

        this.traverse(function(currentNode) {
            if (currentNode === node) {
                found = true;
                return Traverse.CONTINUE;
            }

            if (!found) {
                return Traverse.CONTINUE;
            }

            if (predicate(currentNode)) {
                sibling = currentNode;
                return Traverse.TERMINATE; // stop recursion
            }

            return Traverse.CONTINUE;
        }, opt);
        
        return sibling;
    },

    previousSibling: function(node, predicate, opt) {
        let found = false;
        let previousNodes = [];

        this.traverse(function(currentNode) {
            if (currentNode === node) {
                return Traverse.TERMINATE; // break
            }

            // nodes will be in reverse order
            previousNodes.unshift(currentNode);
            return Traverse.CONTINUE;
        }, opt);

        for (let i = 0, len = previousNodes.length; i < len; ++i) {
            let currentNode = previousNodes[i];

            if (predicate(currentNode)) {
                return currentNode;
            }
        }

        return null;
    },

    hasNode: function(node) {
        let found = false;
        let compare = function(current) {
            if (current === node) {
                found = true;
                return Traverse.TERMINATE; // stop recursion
            }

            return Traverse.CONTINUE;
        }

        this.traverse(compare);
        return found;
    },

    deserializeNode: function(obj) {
        throw new InvalidOperationError("Attempt to call a pure abstract methode.");
    },

    serializeTree: function() {
        let nodeList = [];

        let serializeNode = function(currentNode) {
            let serialized = currentNode.serialize();
            serialized["hasChildren"] = (currentNode.isContainer() && currentNode.hasChildren());
            nodeList.push(serialized);

            // serialize children
            if (currentNode.isContainer() && currentNode.hasChildren()) {
                let children = currentNode._children;

                for (let i = 0, len = children.length; i < len; ++i) {
                    serializeNode(children[i]);
                }

                // this level is complete
                nodeList.push(null);
            }
        };
        serializeNode(this._rootNode);

        return nodeList;
    },
    
    deserializeTree: function(nodeList) {
        assert(Array.isArray(nodeList), "Expected an array as argument.");
        
        let rootNode = this.deserializeNode(nodeList[0]);
        let currentParent = rootNode;

        for (let i = 1, len = nodeList.length; i < len; ++i) {
            let currentObject = nodeList[i];

            if (currentObject != null) {
                let currentNode = this.deserializeNode(currentObject);
                currentParent._appendChild(currentNode);

                if (currentObject.hasChildren) {
                    currentParent = currentNode;
                }
            } else {
                // this level is complete
                currentParent = currentParent.getParent();
            }
        }

        // adjust model
        this.reset(rootNode);

        this.emit("modelReset");
        return this;
    },

    reset: function(rootNode) {
        this._releaseNode(this._rootNode);
        this._rootNode = rootNode;
        this._clearIdMap();
        this._adoptNode(rootNode);

        this.emit("modelReset");
        return this;
    },

    /**
     * Appends the given node to the parent node described by <tt>parentIndex</tt>.
     * @param {Node} node A node which is not owned by any model.
     * @param {ModelIndex} parentIndex The index of the parent node.
     */
    appendNode: function(node, parentIndex) {
        assert(parentIndex.belongsTo(this), "The Index doesn't belong to this Model.");

        let parent = this.getNode(parentIndex);
        this._adoptNode(node);
        parent._appendChild(node);

        let position = parent.getChildCount() - 1;
        this.emit("nodeInserted", node, parent, position);
        return this;
    },

    /**
     * Inserts the given node into the parent node at the specified <tt>position</tt>.
     * @param {Node} node A node which is not owned by any model.
     * @param {ModelIndex} parentIndex The index of the parent node.
     */
    insertNode: function(node, parentIndex, position) {
        assert(parentIndex.belongsTo(this), "The Index doesn't belong to this Model.");

        let parent = this.getNode(parentIndex);
        this._adoptNode(node);
        parent._insertChild(node, position);

        this.emit("nodeInserted", node, parent, position);
        return this;
    },

    moveNode: function(index, referenceIndex, position) {
        assert(index.belongsTo(this), "The Index doesn't belong to this Model.");
        assert(referenceIndex.belongsTo(this), "The Index doesn't belong to this Model.");

        let node = this.getNode(index);
        let srcParent = node.getParent();
        let referenceNode = this.getNode(referenceIndex);

        if (!srcParent) {
            throw new InvalidOperationError("Attempt to move the root node.");
        }

        //[ check for cyclic references
        let currentParent;
        if (position == Position.INSIDE) {
            currentParent = referenceNode;
        } else {
            currentParent = referenceNode.getParent();
        }

        while (currentParent) {
            if (currentParent === node) {
                throw new InvalidOperationError("Attempt to construct cyclic reference.");
            }

            currentParent = currentParent.getParent();
        }
        //]

        if (position == Position.INSIDE) {
            srcParent._takeChild(index.getPosition());
//            referenceNode._appendChild(node);
            referenceNode._insertChild(node, 0); // to be conform with jqtree 0.21
        } else {
            let nodePosition;
            let dstParent = referenceNode.getParent()

            if (!dstParent) {
                throw new InvalidOperationError("Attempt to move out of the root node.");
            }

            srcParent._takeChild(index.getPosition());

            // determine position
            nodePosition = dstParent.getPosition(referenceNode);
            if (position != Position.BEFORE) {
                nodePosition++;
            }

            dstParent._insertChild(node, nodePosition);
        }

        this.emit("nodeMoved", node, srcParent, index.getPosition());
        return this;
    },

    /**
     * oldIds - the first id is the id of the removed node
     */
    removeNode: function(index) {
        assert(index.belongsTo(this), "The Index doesn't belong to this Model.");

        let node = this.getNode(index);
        let oldIds = this._collectIds(node);
        let parent = node.getParent();

        if (!parent) {
            throw new InvalidOperationError("Attempt to remove the root node.");
        }

        parent._takeChild(index.getPosition());
        this._releaseNode(node);

        this.emit("nodeRemoved", index, oldIds);
        return this;
    },

    /**
     * oldIds - the first id is the id of the removed node
     */
    replaceNode: function(oldNode, newNode) {
        assert(!this.hasNode(newNode), "Replacement node already in model.");

        let oldIds = this._collectIds(oldNode);
        let index  = oldNode.getIndex();
        let parent = oldNode.getParent();
        parent._replaceChild(newNode, index.getPosition());

        this._releaseNode(oldNode);
        this._adoptNode(newNode);

        this.emit("nodeReplaced", newNode, oldIds);
        return this;
    },

    swapNodes: function(node1, node2) {
        let parent1 = node1.getParent();
        let parent2 = node2.getParent();

        let position1 = parent1.getPosition(node1);
        let position2 = parent2.getPosition(node2);

        parent1._takeChild(position1);
        parent2._takeChild(position2);

        parent1._insertChild(node2, position1);
        parent2._insertChild(node1, position2);

        this.emit("nodesSwapped", node1, node2);
        return this;
    },

    updateNode: function(node, func) {
        if (typeof func !== "function") {
            throw new TypeError("Expected a function as argument.");
        }

        func(node);

        this.emit("nodeChanged", node);
        return this;
    }
});
module.exports.TreeModel = TreeModel;
