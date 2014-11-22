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

var $tree = null;

function adjustSpacer() {
    var sessionNode = getSessionNode();
    var sessionChildren = sessionNode.children;
    var lastNode = sessionChildren[sessionChildren.length - 1];

    if (lastNode) {
        var spacerHeight = window.innerHeight - lastNode.element.offsetHeight - 4;
        $("#spacer").css("height", spacerHeight);
    } else {
        $("#spacer").css("height", 0);
    }
}

function canMoveTo(node, targetNode, position) {
    if ((targetNode.type == "session") &&
        (position != "inside"))
    {
        return false;
    }

    if ((!isContainer(targetNode)) &&
        (position == "inside"))
    {
        return false;
    }

    if (node.type == "tab") {
        var windowNode;

        //[ every tab node has to be inside a window node
        switch (position) {
            case "inside":
                windowNode = getWindowNode(targetNode);
                break;
            case "after":
            case "before":
                var parentNode = targetNode.parent;
                if (parentNode) {
                    windowNode = getWindowNode(parentNode);
                }
                break;
        }

        if (!windowNode) {
            return false;
        }
        //]

        //[ isolate pinned area (the pinned area ends with the first node which is not pinned)
        var borderNode = null;
        var pinnedArea = [];
        var followingIndex = 0;

        var descendants = getDescendants(windowNode);
        for (var i = 0, len = descendants.length; i < len; ++i) {
            var currentNode = descendants[i];

            if ((currentNode.type == "tab") &&
                (!isPinned(currentNode)))
            {
                followingIndex = i;
                break;
            }
        }

        if (followingIndex > 0) {
            pinnedArea = descendants.slice(0, followingIndex);
            borderNode = pinnedArea[followingIndex - 1];

            var nextParent = borderNode.parent;
            while (!isTabContainer(nextParent)) {
                borderNode = nextParent;
                nextParent = borderNode.parent;
            }
        }
        //]

        //[ validate move target
        var result = true;
        var targetInPinnedArea = (pinnedArea.indexOf(targetNode) != -1);

        if (isPinned(node)) {
            switch (position) {
                case "before":
                    if (!targetInPinnedArea) {
                        var index = descendants.indexOf(targetNode);
                        result &= (pinnedArea.length == index);
                    }
                    break;
                case "after":
                case "inside":
                    if (targetNode !== windowNode) {
                        result &= targetInPinnedArea;
                    }
                    break;
            }
        } else {
            switch (position) {
                case "after":
                    if (targetInPinnedArea) {
                        result &= (targetNode === borderNode);
                    }
                    break;
                case "before":
                case "inside":
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

function handleToggleEvent(e) {
    addon.port.emit("treeEvent", "nodeToggle", e.node.id, e.node.is_open);
}

function hasActiveSubNodes(node) {
    var children = node.children;
    for (var i = 0, len = children.length; i < len; ++i) {
        var currentNode = children[i];
        var active = ("active" in currentNode) && currentNode.active;

        if (active || hasActiveSubNodes(currentNode)) {
            return true;
        }
    }

    return false;
}

function hideHoverMenu() {
    $(".hmenu").remove();
}

function getLabel(oldLabel) {
    var label = prompt("Label:", oldLabel);
    return label;
}

function getNodeByElement($treeElement) {
    var $li = $treeElement.closest('li.jqtree_common');
    if ($li.length === 0) {
        return null;
    }

    return $li.data('node');
}

function getSessionNode() {
    var rootNode = $tree.tree('getTree');
    return rootNode.children[0];
}

function loadChildren(node, data) {
    if ("children" in data) {
        $tree.tree('loadData', data.children, node);
        return;
    }
}

function provideCloseAction(node) {
    var active = ("active" in node) && node.active;

    if (active) {
        return true;
    } else  {
        var collapsed = ("is_open" in node) && !node.is_open;
        return (collapsed && hasActiveSubNodes(node));
    }
}

function showHoverMenu($treeElement) {
    var node = getNodeByElement($treeElement);
    if (!!node == false) {
        return;
    }

    var actions = [];

    // edit action:
    if (node.type == "session" ||
        node.type == "group" ||
        node.type == "window" ||
        node.type == "text")
    {
        actions.push("edit-action");
    }

    // delete action:
    if (node.type != "session") {
        actions.push("delete-action");
    }

    // close action:
    if (provideCloseAction(node)) {
        actions.push("close-action");
    }

    if (actions.length === 0) {
        return;
    }

    //[ create menu
    var container = document.createElement("div");
    container.className = "hmenu";

    var panel = document.createElement("span");
    panel.className = "hmenu-panel";

    for (var i = 0, len = actions.length; i < len; ++i) {
        var action = document.createElement("span");
        action.className = "hmenu-button " + actions[i];
        action.setAttribute("data-node-id", node.id);

        panel.appendChild(action);
    }

    container.appendChild(panel);
    $treeElement.before(container);
    //]
}

const UpdateReason = {
    INSERT: 0,
    REMOVE: 1
};

function updateNodeCount(updateReason, affectedNode) {
    var hasSubNodes = hasChildren(affectedNode);

    var deltaNodeCount = 1; // itself
    var deltaActiveTabCount = 0;
    var deltaActiveWindowCount = 0;

    //[ collect delta
    if (isActiveTab(affectedNode)) {
        deltaActiveTabCount += 1;
    } else if (isActiveWindow(affectedNode)) {
        deltaActiveWindowCount += 1;
    }

    if (updateReason == UpdateReason.INSERT) {
        initializeNodeCount(affectedNode)
    }

    if (isContainer(affectedNode)) {
        deltaNodeCount += affectedNode.subNodeCount.nodes;
        deltaActiveTabCount += affectedNode.subNodeCount.activeTabNodes;
        deltaActiveWindowCount += affectedNode.subNodeCount.activeWindowNodes;
    }
    //]

    if (updateReason == UpdateReason.REMOVE) {
        deltaNodeCount = -deltaNodeCount;
        deltaActiveTabCount = -deltaActiveTabCount;
        deltaActiveWindowCount = -deltaActiveWindowCount;
    }

    //[ update parent hierarchy
    var parentWalker = function(currentParent) {
        var subNodeCount = currentParent.subNodeCount;

        // update
        subNodeCount.nodes += deltaNodeCount;
        subNodeCount.activeTabNodes += deltaActiveTabCount;
        subNodeCount.activeWindowNodes += deltaActiveWindowCount;

        $tree.tree(
            'updateNode',
            currentParent,
            { subNodeCount: subNodeCount }
        );

        if (currentParent.type == "session") {
            return;
        }

        var nextParent = currentParent.parent;
        if (!!nextParent != false) {
            parentWalker(nextParent);
        }
    };

    parentWalker(affectedNode.parent);
    //]
}

function initializeNodeCount(node) {
    var subNodeCount = {
        nodes: 0,
        activeTabNodes: 0,
        activeWindowNodes: 0
    };

    var children = node.children;
    for (var i = 0, len = children.length; i < len; ++i) {
        var currentNode = children[i];

        subNodeCount.nodes += 1;

        if (isActiveTab(currentNode)) {
            subNodeCount.activeTabNodes += 1;
        } else if (isActiveWindow(currentNode)) {
            subNodeCount.activeWindowNodes += 1;
        }

        if (isContainer(currentNode)) {
            initializeNodeCount(currentNode);

            subNodeCount.nodes += currentNode.subNodeCount.nodes;
            subNodeCount.activeTabNodes += currentNode.subNodeCount.activeTabNodes;
            subNodeCount.activeWindowNodes += currentNode.subNodeCount.activeWindowNodes;
        }
    }

    node.subNodeCount = subNodeCount;

    $tree.tree(
        'updateNode',
        node,
        { subNodeCount: subNodeCount }
    );
}

function displayNodeCount(node, $li) {
    if (!hasChildren(node)) {
        return;
    }

    var nodeCount = node.subNodeCount;

    console.log("Node #", node.id, "count:", node.subNodeCount);

    var nodeCountSpan = document.createElement("span");
    nodeCountSpan.className = "node-count";
    nodeCountSpan.appendChild(
        document.createTextNode(
            "[" + nodeCount.nodes + "n|" +
            nodeCount.activeTabNodes + "t|" +
            nodeCount.activeWindowNodes + "w]"
        )
    );

    $li.find('.jqtree-title').
        prepend(nodeCountSpan);
}

function displayNodeCountIf(predicate, node, $li) {
    if (predicate(node)) {
        displayNodeCount(node, $li);
    }
}

function displayNodeCountPredicate(node) {
    var result = ("is_open" in node) && !node.is_open;
    return result;
}

function validateTree() {
    var root = $tree.tree('getTree');
    var id_mapping = root.id_mapping;

    var walker = function(node) {
        var children = node.children;
        for (var i = 0, len = children.length; i < len; ++i) {
            walker(children[i]);
        }

        if (!("id" in node)) {
            return;
        }

        var id = node.id;
        if (!(id in id_mapping)) {
            console.error("ID not in map: " + id);
            return;
        }

        if (id_mapping[id] !== node) {
            console.error("Corrupted mapping of node with id: " + id);
            return;
        }
    };

    walker(root);
}

// ****************************************************************************
// initialization:

$(function() {
    if (!!window.addon == false) {
        alert("Jetpack communication port is not available!");
        return;
    }

    $tree = $('#sessionTree');
    $tree.tree({
        data: [],
        autoOpen: false,
        dragAndDrop: true,
        onCreateLi: function(node, $li) {
            $li.find('.jqtree-element').mouseenter(function(e) {
                var $treeElement = $(e.target).closest('.jqtree-element');
                if (!!$treeElement == false) {
                    return;
                }

                hideHoverMenu();
                showHoverMenu($treeElement);
            });

            if (!isActive(node)) {
                $li.addClass("inactive-node");
            }

            if (isSelected(node)) {
                $li.addClass("selected-node");
            }

            if (isPinned(node)) {
                $li.addClass("pinned-node");
            }

            if (node.type == "tab") {
                $li.find('.jqtree-title').
                    before('<img class="icon" src="' + node.favicon + '" />');
            }

            if (isContainer(node) && ("subNodeCount" in node)) {
                displayNodeCountIf(displayNodeCountPredicate, node, $li);
            }

            $li.addClass("so-" + node.type + "-node");
        },
        onCanSelectNode: function(node) {
            return true;
        },
        onCanMove: function(node) {
            return (node.type != "session");
        },
        onCanMoveTo: canMoveTo
    });

    $tree.mouseleave(hideHoverMenu);

    // Handle a click on the delete link
    $tree.on(
        'click', '.delete-action',
        function(e) {
            // Get the id from the 'node-id' data property
            var node_id = $(e.target).data('node-id');

            // Get the node from the tree
            var node = $tree.tree('getNodeById', node_id);

            if (!!node == false) {
                return;
            }

            var detach = ("is_open" in node) && node.is_open;
            addon.port.emit("treeEvent", "removeNode", node_id, detach);
        }
    );

    $tree.on(
        'click', '.close-action',
        function(e) {
            var node_id = $(e.target).data('node-id');
            var node = $tree.tree('getNodeById', node_id);

            if (!!node == false) {
                return;
            }

            var withSubNodes = ("is_open" in node) && !node.is_open;
            addon.port.emit("treeEvent", "closeNode", node_id, withSubNodes);
        }
    );

    $tree.on(
        'click', '.edit-action',
        function(e) {
            var node_id = $(e.target).data('node-id');
            var node = $tree.tree('getNodeById', node_id);

            if (!!node == false) {
                return;
            }

            var newLabel = getLabel(node.name);
            if (!!newLabel == false) {
                return;
            }

            addon.port.emit("treeEvent", "changeLabel", node_id, newLabel);
        }
    );

    //[ workaround:
    $tree.on(
        'mousedown', '.hmenu-button',
        function(e) {
            $(this).addClass('hmenu-button-active');
        }
    );

    $tree.on(
        'mouseleave', '.hmenu-button',
        function(e) {
            $(this).removeClass('hmenu-button-active');
        }
    );

    $tree.on(
        'mouseup', '.hmenu-button',
        function(e) {
            $(this).removeClass('hmenu-button-active');
        }
    );
    //]

    $tree.bind('tree.open', handleToggleEvent);

    $tree.bind('tree.close', handleToggleEvent);

    $tree.bind(
        'tree.dblclick',
        function(e) {
            addon.port.emit("treeEvent", "activateNode", e.node.id);
        }
    );

    $tree.bind(
        'tree.move',
        function(event) {
            event.preventDefault();
            var nodeId   = event.move_info.moved_node.id;
            var targetId = event.move_info.target_node.id;
            var position = event.move_info.position;
            addon.port.emit("treeEvent", "moveNode", nodeId, targetId, position);
        }
    );

    $(".mainMenuLink").click(function() {
        var action   = $(this).attr("id");
        var node     = $tree.tree('getSelectedNode');
        var params   = ["menuEvent", action];

        //[ get target Id
        if (!!node == false) {
            var sessionNode = getSessionNode();
            params.push(sessionNode.id);
        } else {
            params.push(node.id);
        }
        //]

        if (action == "createNoteLink") {
            var label = getLabel("#");
            if (!!label == false) {
                return;
            }

            params.push(label);
        }

        addon.port.emit.apply(addon.port, params);
    });

    $("#update").click(function() {
        addon.port.emit("update");
    });

    $(".test").click(function() {
        addon.port.emit("test", $(this).attr("id"));
    });

    window.onresize = adjustSpacer;

    // request tree
    addon.port.emit("ready");
});

// ****************************************************************************
// Model event handlers:

addon.port.on("updateTreeData", function(data) {
    $tree.tree('loadData', [data]);

    // handle node count
    var sessionNode = getSessionNode();
    initializeNodeCount(sessionNode);

    adjustSpacer();
});

addon.port.on("updateTreeNode", function(id, data) {
    var node = $tree.tree('getNodeById', id);
    if (!node) {
        console.error("node not found!");
        return;
    }

    if ("children" in data) {
        console.warn("Node data should not contain sub nodes.");
        delete data["children"];
    }

    $tree.tree('updateNode', node, data);

    // NOTE: its not necessary to call updateNodeCount()

    validateTree();
    adjustSpacer();
});

addon.port.on("replaceTreeNode", function(id, data) {
    var node = $tree.tree('getNodeById', id);
    if (!node) {
        console.error("node not found!");
        return;
    }

    updateNodeCount(UpdateReason.REMOVE, node);

    var newNode = $tree.tree('replaceNode', node, data);
    loadChildren(newNode, data);
    updateNodeCount(UpdateReason.INSERT, newNode);

    validateTree();
    adjustSpacer();
});

addon.port.on("removeTreeNode", function(id) {
    var node = $tree.tree('getNodeById', id);
    if (!node) {
        console.error("node not found!");
        return;
    }

    updateNodeCount(UpdateReason.REMOVE, node);
    $tree.tree('removeNode', node);

    validateTree();
    adjustSpacer();
});

addon.port.on("appendTreeNode", function(data, parentId) {
    var parentNode = $tree.tree('getNodeById', parentId);
    if (!parentNode) {
        console.error("node not found!");
        return;
    }

    var node = $tree.tree('appendNode', data, parentNode);
    loadChildren(node, data);
    updateNodeCount(UpdateReason.INSERT, node);

    validateTree();
    adjustSpacer();
});

addon.port.on("insertTreeNode", function(data, referenceId, after) {
    var referenceNode = $tree.tree('getNodeById', referenceId);
    if (!referenceNode) {
        console.error("referenceNode not found!");
        return;
    }

    var node;
    if (after) {
        node = $tree.tree('addNodeAfter', data, referenceNode);
    } else {
        node = $tree.tree('addNodeBefore', data, referenceNode);
    }
    loadChildren(node, data);
    updateNodeCount(UpdateReason.INSERT, node);

    validateTree();
    adjustSpacer();
});

addon.port.on("moveTreeNode", function(id, referenceId, position) {
    var node = $tree.tree('getNodeById', id);
    if (!node) {
        console.error("node not found!");
        return;
    }

    updateNodeCount(UpdateReason.REMOVE, node);

    var referenceNode = $tree.tree('getNodeById', referenceId);
    if (!referenceNode) {
        console.error("referenceNode not found!");
        return;
    }

    $tree.tree('moveNode', node, referenceNode, position);
    updateNodeCount(UpdateReason.INSERT, node);

    validateTree();
    adjustSpacer();
});

addon.port.on("tabSelect", function(id) {
    var selectedNode = $tree.tree('getNodeById', id);
    if (!selectedNode) {
        console.error("selectedNode not found!");
        return;
    }

    var windowNode = getWindowNode(selectedNode);
    if (!windowNode) {
        console.error("windowNode not found!");
        return;
    }

    var tabNodes = matchNodes(function(currentNode) {
        return (currentNode.type == "tab");
    }, windowNode, filterNestedWindows(windowNode));

    for (var i = 0, len = tabNodes.length; i < len; ++i) {
        var tabNode = tabNodes[i];

        var isSelected = !!(tabNode === selectedNode);
        $tree.tree('updateNode', tabNode, { selected: isSelected });
    }
});

// ****************************************************************************
// TEST:

addon.port.on("updateTreeData", function(data) {
    $("#treeData").text(JSON.stringify(data, undefined, 2));
});
