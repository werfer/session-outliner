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

// sdk:
const _ = require("sdk/l10n").get;

const { browserObserver } = require("observer");
const { openBrowser } = require("browser");
const { IDBStorageBackend } = require("storage");

const {
    assert,
    handleException,
    printArgs,
    isEmpty
} = require("utils");

const {
    Position,
    Traverse,
    ModelIndex,
} = require("treemodel");

const {
    SessionNode,
    TextNode,
    SeparatorNode,
    WindowNode,
    ActiveWindowNode,
    TabNode,
    ActiveTabNode,
    TabModel,
    Filters,
    getWindowNode,
    getTopMostTabNode,
    activateWindow,
    activateTab,
    deleteTabNode,
    deleteWindowNode,
    createHomeNode
} = require("tabmodel");

// ****************************************************************************
// TreeView event handlers:

function treeCloseHandler(model, id, withSubNodes) {
    if (!model.hasId(id)) {
        return;
    }

    // replace the active node with a new inactive node
    let node = model.getNodeById(id);
    assert(node, "Node not found.");

    if (withSubNodes) {
        let index = node.getIndex();

        //[ first stage: close windows
        let activeWindowNodes = model.getActiveWindowNodes(node);

        activeWindowNodes.forEach(function(currentNode) {
            model.closeNode(currentNode);
        });
        //]

        //[ second stage: close remaining tabs
        let groupNode = model.getNode(index); // the group node could already be closed
        let activeTabNodes = model.getActiveTabNodes(groupNode); 

        activeTabNodes.forEach(function(currentNode) {
            model.closeNode(currentNode);
        });
        //]

        return;
    } else {
        model.closeNode(node);
    }
}

function treeRemoveHandler(model, id, detach) {
    if (!model.hasId(id)) {
        return;
    }

    let node = model.getNodeById(id);
    assert(node, "Node not found.");

    if (node instanceof WindowNode) {
        deleteWindowNode(node, detach);
    } else if (node instanceof TabNode) {
        deleteTabNode(node, detach);
    } else if (node instanceof SessionNode) {
        console.warn("Attempt to remove session node.");
    } else {
        assert(!node.isContainer(), "Unknown node.");
        model.removeNode(node.getIndex());
    }
}

function treeActivateHandler(model, id) {
    if (!model.hasId(id)) {
        return;
    }

    // the old node will be replaced
    let node = model.getNodeById(id);
    assert(node, "Node not found.");

    if (node instanceof TabNode && !node.isActive()) {
        return activateTab(node);
    } else if (node instanceof WindowNode && !node.isActive()) {
        return activateWindow(node);
    } else if (node instanceof ActiveTabNode) {
        node.focus();
    } else if (node instanceof ActiveWindowNode) {
        node.focus();
    } else {
        console.warn("viewActivateNode: Invalid node type.");
    }
}

// ----------------------------------------------------------------------------

function canMoveTo(node, targetNode, position) {
    let model = node.getModel();

    if ((targetNode instanceof SessionNode) &&
        (position != Position.INSIDE))
    {
        return false;
    }

    if ((!targetNode.isContainer()) &&
        (position == Position.INSIDE))
    {
        return false;
    }

    if (node instanceof TabNode) {
        let windowNode;

        //[ every tab node has to be inside a window node
        switch (position) {
            case Position.INSIDE:
                windowNode = getWindowNode(targetNode);
                break;
            case Position.AFTER:
            case Position.BEFORE:
                let parentNode = targetNode.getParent();
                if (parentNode) {
                    windowNode = getWindowNode(parentNode);
                }
                break;
        }

        if (!windowNode) {
            return false;
        }
        //]

        //[ isolate pinned area (the pinned area end with the first node which is not pinned)
        let borderNode = null;
        let pinnedArea = [];
        let followingIndex = 0;

        let descendants = model.getDescendants(windowNode);
        for (let i = 0, len = descendants.length; i < len; ++i) {
            let currentNode = descendants[i];

            if ((currentNode instanceof TabNode) &&
                (!currentNode.isPinned()))
            {
                followingIndex = i;
                break;
            }
        }

        if (followingIndex > 0) {
            pinnedArea = descendants.slice(0, followingIndex);
            borderNode = pinnedArea[followingIndex - 1];

            let nextParent = borderNode.getParent();
            while (!(nextParent instanceof WindowNode)) {
                borderNode = nextParent;
                nextParent = borderNode.getParent();
            }
        }
        //]

        //[ validate move target
        let result = true;
        let targetInPinnedArea = (pinnedArea.indexOf(targetNode) != -1);

        if (node.isPinned()) {
            switch (position) {
                case Position.BEFORE:
                    if (!targetInPinnedArea) {
                        let index = descendants.indexOf(targetNode);
                        result &= (pinnedArea.length == index);
                    }
                    break;
                case Position.AFTER:
                case Position.INSIDE:
                    if (targetNode !== windowNode) {
                        result &= targetInPinnedArea;
                    }
                    break;
            }
        } else {
            switch (position) {
                case Position.AFTER:
                    if (targetInPinnedArea) {
                        result &= (targetNode === borderNode);
                    }
                    break;
                case Position.BEFORE:
                case Position.INSIDE:
                    if (targetNode === windowNode) {
                        result &= isEmpty(pinnedArea);
                    } else {
                        result &= !targetInPinnedArea;
                    }
                    break;
            }
        }

        if (!result) {
            return false;
        }
        //]
    }

    return true;
}

function treeMoveHandler(model, id, targetId, viewPosition) {
    if (!model.hasId(id)) {
        return;
    }

    if (!!targetId == false) {
        console.warn("No target supplied.");
        return;
    }

    let node = model.getNodeById(id);
    let targetNode = model.getNodeById(targetId);

    let position;
    switch (viewPosition) {
        case "before":
            position = Position.BEFORE;
            break;
        case "after":
            position = Position.AFTER;
            break;
        case "inside":
            position = Position.INSIDE;
            break;
        default:
            console.error("Invalid position.");
            return;
    }

    //[ change target for non-pinned nodes
    if (node instanceof TabNode &&
        targetNode instanceof WindowNode &&
        position == Position.INSIDE &&
        !node.isPinned())
    {
        let windowNode = targetNode;
        let lastPinnedNode = model.findLastNode(function(currentNode) {
            if (currentNode instanceof TabNode && currentNode.isPinned()) {
                return true;
            }
            return false;
        }, Filters.filterNestedWindows(windowNode));

        if (lastPinnedNode) {
            let borderNode = lastPinnedNode;
            let nextParent = borderNode.getParent();

            while (!(nextParent instanceof WindowNode)) {
                borderNode = nextParent;
                nextParent = borderNode.getParent();
            }

            targetNode = borderNode;
            position   = Position.AFTER;
        }
    }
    //]

    //[ valid move?
    if (!canMoveTo(node, targetNode, position)) {
        console.warn("Move is not permitted.");
        return;
    }
    //]

    model.moveNode(node.getIndex(), targetNode.getIndex(), position);
}

// ----------------------------------------------------------------------------

function treeDetachChildren(model, id) {
    if (!model.hasId(id)) {
        return;
    }

    let node = model.getNodeById(id);
    model.detachAll(node);
}

function treeNodeToggle(model, id, isOpen) {
    if (!model.hasId(id)) {
        return;
    }

    let node = model.getNodeById(id);
    model.updateNode(node, function(node) {
        node.putEntry({
            key: "collapsed",
            value: !isOpen
        });
    });
}

function treeChangeLabel(model, id, newLabel) {
    if (!model.hasId(id)) {
        return;
    }

    let node = model.getNodeById(id);
    model.updateNode(node, function(node) {
        node.setLabel(newLabel);
    });
}

const treeEventHandlers = {
    "activateNode":   treeActivateHandler,
    "closeNode":      treeCloseHandler,
    "removeNode":     treeRemoveHandler,
    "moveNode":       treeMoveHandler,
    "detachChildren": treeDetachChildren,
    "nodeToggle":     treeNodeToggle,
    "changeLabel":    treeChangeLabel
};

// ****************************************************************************
// Menu event handlers:

function emplaceNode(model, node, targetId) {
    if (!model.hasId(targetId)) {
        console.warn("Node not in model.");
        return;
    }

    let targetNode = model.getNodeById(targetId);
    if (targetNode.isContainer()) {
        model.appendNode(node, targetNode.getIndex());
    } else {
        let parentNode = targetNode.getParent();
        assert(parentNode, "Parent node not found.");
        
        let position = parentNode.getPosition(targetNode) + 1;
        model.insertNode(node, parentNode.getIndex(), position);
    }
}

function menuCreateGroup(model, targetId) {
    let groupNode = WindowNode({
        data: { _windowName: _("Group") },
        metadata: { isGroup: true }
    });
    emplaceNode(model, groupNode, targetId);
}

function menuCreateSeparator(model, targetId) {
    let node = SeparatorNode();
    emplaceNode(model, node, targetId);
}

function menuCreateNote(model, targetId, label) {
    let node = TextNode();
    node.setLabel(label);
    emplaceNode(model, node, targetId);
}

function menuOpenWindow(model) {
     openBrowser("about:newtab");
}

function menuCloseAll(model) {
    let rootNode = model.getRootNode();
    let activeWindowNodes = model.getActiveWindowNodes(rootNode);

    activeWindowNodes.forEach(function(currentNode) {
        model.closeNode(currentNode);
    });
}

const menuEventHandlers = {
    "createGroupLink":     menuCreateGroup,
    "createSeparatorLink": menuCreateSeparator,
    "createNoteLink":      menuCreateNote,
    "createWindowLink":    menuOpenWindow,
    "closeAllLink":        menuCloseAll
};

// ****************************************************************************

function handleEvent(eventHandlers, event) {
    let params = Array.slice(arguments, 1);
    params[0] = outliner.getModel();

    try {
        if (event in eventHandlers) {
            let handler = eventHandlers[event];
            handler.apply(undefined, params);
        } else {
            console.error("No handler for: " + event);
        }
    } catch (e) {
        handleException(e);
    }
}

const handleTreeEvent = handleEvent.bind(undefined, treeEventHandlers);
const handleMenuEvent = handleEvent.bind(undefined, menuEventHandlers);

// ****************************************************************************
// standalone utils:

function composeTreeNodeData(node, recursive) {
    let model = outliner.getModel();

    let data = (function handleNode(node) {
        let nodeData = {
            id: node.getId()
        };

        if (node instanceof SessionNode) {
            nodeData["type"]  = "session";
            nodeData["label"] = node.getLabel();
        } else if (node instanceof WindowNode) {
            if (node.isGroup()) {
                nodeData["type"]   = "group";
            } else {
                nodeData["type"]   = "window";
                nodeData["active"] = node.isActive();
            }
            nodeData["label"]   = node.getLabel();
        } else if (node instanceof TabNode) {
            nodeData["type"]    = "tab";
            nodeData["label"]   = node.getTitle();
            nodeData["favicon"] = node.getFavicon();

            if (node.isActive()) {
                nodeData["active"] = true;
            }

            if (node.isPinned()) {
                nodeData["pinned"] = true;
            }
        } else if (node instanceof TextNode) {
            nodeData["type"]  = "text";
            nodeData["label"] = node.getLabel();
        } else if (node instanceof SeparatorNode) {
            nodeData["type"]  = "separator";
            nodeData["label"] = "---";
            nodeData["style"] = node.getStyle();
        }

        if (!node.isContainer()) {
            return nodeData;
        }

        //[ handle container nodes
        if (recursive && node.hasChildren()) {
            let children = [];
            node.forEach(function(childNode) {
                let childData = handleNode(childNode);
                children.push(childData);
            });

            nodeData["children"] = children;
            nodeData["is_open"]  = !(node.hasEntry("collapsed") && node.getValue("collapsed"));
        } else if (node.hasEntry("collapsed")) {
            nodeData["is_open"]  = !node.getValue("collapsed");
        } else {
            nodeData["is_open"] = true;
        }
        //]

        return nodeData;
    })(node);

    return data;
}

// ----------------------------------------------------------------------------

function moveTreeViewNode(node, newIndex, dispatcher) {
    let position = newIndex.getPosition();
    let parentNode = node.getParent();
    let viewPosition;
    let referenceNode;

    if (parentNode.getChildCount() > 1) {
        let after = (position > 0);
        let referencePosition = (after ? position - 1 : position + 1);
        
        viewPosition = (after ? "after" : "before");
        referenceNode = parentNode.getChild(referencePosition);
    } else {
        assert(parentNode.hasNode(node), "Model corruption.");
        
        viewPosition = "inside";
        referenceNode = parentNode;
    }

    dispatcher("moveTreeNode", node.getId(), referenceNode.getId(), viewPosition);
}

// ****************************************************************************
// TabModel event handlers:

function onModelReset(event) {
    let model = event.sender;
    let dispatcher = event.subject; // tree view dispatcher

    let node = model.getRootNode();
    dispatcher("updateTreeData", composeTreeNodeData(node, true));
}

function onModelNodeChanged(event, node) {
    // event.subject: tree view dispatcher
    let model = event.sender;
    let dispatcher = event.subject;

    let data = composeTreeNodeData(node, false);
    dispatcher("updateTreeNode", node.getId(), data);
}

function onModelNodeRemoved(event, index, oldIds) {
    let dispatcher = event.subject;

    // the first id within `oldIds` is the id of the top most parent
    dispatcher("removeTreeNode", oldIds[0]);
}

function onModelNodeReplaced(event, newNode, oldIds) {
    let dispatcher = event.subject;
    let data = composeTreeNodeData(newNode, true);

    dispatcher("replaceTreeNode", oldIds[0], data);
}

function onModelNodeMoved(event, node, oldParent, position) {
    let dispatcher = event.subject;
    let newIndex = node.getIndex();

    moveTreeViewNode(node, newIndex, dispatcher);
}

function onModelNodeInserted(event, node, parentNode, position) {
    let dispatcher = event.subject;
    let data = composeTreeNodeData(node, true);

    if (parentNode.back() === node) {
        dispatcher("appendTreeNode", data, parentNode.getId());
    } else {
        let after = (position > 0);
        let referencePosition = (after ? position - 1 : position + 1);
        let referenceNode = parentNode.getChild(referencePosition);

        dispatcher("insertTreeNode", data, referenceNode.getId(), after);
    }
}

function onModelNodesSwapped(event, node1, node2) {
    let dispatcher = event.subject;

    moveTreeViewNode(node1, node1.getIndex(), dispatcher);
    moveTreeViewNode(node2, node2.getIndex(), dispatcher);
}

// ****************************************************************************

const outliner = function() {
    const system = require("sdk/system/events");

    let model = null;
    let storageBackend = null;

    let init = function() {
        model = TabModel();
        storageBackend = IDBStorageBackend(model);
        storageBackend.init();

        model.on("modelReset",    onModelReset,        dispatchEvent);
        model.on("nodeChanged",   onModelNodeChanged,  dispatchEvent);
        model.on("nodeReplaced",  onModelNodeReplaced, dispatchEvent);
        model.on("nodeMoved",     onModelNodeMoved,    dispatchEvent);
        model.on("nodeRemoved",   onModelNodeRemoved,  dispatchEvent);
        model.on("nodeInserted",  onModelNodeInserted, dispatchEvent);
        model.on("nodesSwapped",  onModelNodesSwapped, dispatchEvent);

        system.on("quit-application-granted",   onQuitApplicationGranted);
    };

    let onQuitApplicationGranted = function(event) {
        console.log("shutdown");

        storageBackend.dispose();
        model.dispose();
        workerArray.length = 0;
    };

    let getModel = function() {
        return model;
    };

    let workerArray = [];

    // only for testing
    let updateTreeView = function() {
        workerArray.forEach(function(worker) {
            let node = model.getRootNode();
            worker.port.emit("updateTreeData", composeTreeNodeData(node, true));
        });
    };

    let dispatchEvent = function(event) {
        let args = Array.slice(arguments);
        workerArray.forEach(function(worker) {
            worker.port.emit.apply(worker.port, args);
        });
    };

    let addWorker = function(worker) {
        workerArray.push(worker);

        worker.port.on("ready", function onReady() {
            worker.port.removeListener("ready", onReady);

            let node = model.getRootNode();
            worker.port.emit("updateTreeData", composeTreeNodeData(node, true));
        });

        //[ only for testing
        worker.port.on("test", test);
        worker.port.on("update", updateTreeView);
        //]

        worker.port.on("treeEvent", handleTreeEvent);
        worker.port.on("menuEvent", handleMenuEvent);
    };

    let removeWorker = function(worker) {
        //[ only for testing
        worker.port.removeListener("test", test);
        worker.port.removeListener("update", updateTreeView);
        //]

        worker.port.removeListener("treeEvent", handleTreeEvent);
        worker.port.removeListener("menuEvent", handleMenuEvent);

        let index = workerArray.indexOf(worker);
        if (index != -1) {
            workerArray.splice(index, 1);
        }
    };

    return {
        init: init,
        getModel: getModel,
        addWorker: addWorker,
        removeWorker: removeWorker
    }
}();
module.exports.outliner = outliner;

// ****************************************************************************
// TEST:

function test(str) {
    console.log(str);
    
    let model = outliner.getModel();

    switch (str) {
    case "test1":
    {
        let parentNode = model.findFirstNode(function(currentNode) {
            return (currentNode instanceof ActiveWindowNode);
        });
        
        if (!parentNode) {
            break;
        }

        let parentIndex = parentNode.getIndex();
        let tabNode = TabNode({
            data: {
                _url: "http://www.mozilla.org/",
                _title: "mozilla",
                _favicon: "chrome://mozapps/skin/places/defaultFavicon.png"
            }
        });
        
        model.insertNode(tabNode, parentIndex, 1);

        activateTab(tabNode);
        break;
    }
    case "test2":
    {
        let windowNode = WindowNode({
            data: { _windowName: "test win" }
        });

        model.appendNode(windowNode, model.getRootNode().getIndex());
        
        let parentIndex = windowNode.getIndex();
        let tabNode = TabNode({
            data: {
                _url: "http://www.mozilla.org/",
                _title: "mozilla",
                _favicon: "chrome://mozapps/skin/places/defaultFavicon.png",
                _isPinned: true
            }
        });
        model.appendNode(tabNode, parentIndex);

        activateTab(tabNode);
        break;
    }
    case "test3":
    {
        let windowNode = WindowNode({
            data: { _windowName: "test win2" }
        });

        model.appendNode(windowNode, model.getRootNode().getIndex());

        let parentIndex = windowNode.getIndex();

        let tabNode1 = TabNode({
            data: {
                _url: "http://www.mozilla.org/",
                _title: "mozilla",
                _favicon: "chrome://mozapps/skin/places/defaultFavicon.png"
            }
        });

        let tabNode2 = TabNode({
            data: {
                _url: "http://developer.mozilla.org/",
                _title: "developer",
                _favicon: "chrome://mozapps/skin/places/defaultFavicon.png"
            }
        });

        model.appendNode(tabNode1, parentIndex);
        model.appendNode(tabNode2, parentIndex);

        activateWindow(windowNode);
        break;
    }
    case "validate":
        model.validateModel();
        break;
    case "status":
        status();
        break;
    }
}

function status() {
    console.log("=== STATUS ===");

    let model = outliner.getModel();

    console.log("Serialized tree:");
    let serialized = model.serializeTree();
    console.log(JSON.stringify(serialized, undefined, 2));

    console.log("Nodes:");
    model.traverseAll(function(node) {
        console.log("node: " + node);
        console.log("ModelIndex: " + node.getIndex());
    });

    console.log("=== END ===");
}
