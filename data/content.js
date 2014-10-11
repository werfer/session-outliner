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

function adjustSpacer() {
    var root = $('#sessionTree').tree('getTree');
    var sessionChildren = root.children[0].children;
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

        //[ isolate pinned area (the pinned area end with the first node which is not pinned)
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

function loadChildren(node, data) {
    if ("children" in data) {
        var $tree = $('#sessionTree');
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

function validateTree() {
    var root = $('#sessionTree').tree('getTree');
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

    var $tree = $('#sessionTree');

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

            if (isPinned(node)) {
                $li.addClass("pinned-node");
            }

            if (node.type == "tab") {
                $li.find('.jqtree-title').
                    before('<img class="icon" src="' + node.favicon + '" />');
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
            var rootNode    = $('#sessionTree').tree('getTree');
            var sessionNode = rootNode.children[0];
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
    var $tree = $('#sessionTree');
    $tree.tree('loadData', [data]);
    adjustSpacer();
});

addon.port.on("updateTreeNode", function(id, data) {
    var $tree = $('#sessionTree');

    var node = $tree.tree('getNodeById', id);
    if (!node) {
        console.error("node not found!");
        return;
    }

    if ("children" in data) {
        delete data["children"];
    }

    $tree.tree('updateNode', node, data);

    validateTree();
    adjustSpacer();
});

addon.port.on("replaceTreeNode", function(id, data) {
    var $tree = $('#sessionTree');

    var node = $tree.tree('getNodeById', id);
    if (!node) {
        console.error("node not found!");
        return;
    }

    var newNode = $tree.tree('replaceNode', node, data);
    loadChildren(newNode, data);

    validateTree();
    adjustSpacer();
});

addon.port.on("removeTreeNode", function(id) {
    var $tree = $('#sessionTree');

    var node = $tree.tree('getNodeById', id);
    if (!node) {
        console.error("node not found!");
        return;
    }

    $tree.tree('removeNode', node);

    validateTree();
    adjustSpacer();
});

addon.port.on("appendTreeNode", function(data, parentId) {
    var $tree = $('#sessionTree');

    var parentNode = $tree.tree('getNodeById', parentId);
    if (!parentNode) {
        console.error("node not found!");
        return;
    }

    var node = $tree.tree('appendNode', data, parentNode);
    loadChildren(node, data);

    validateTree();
    adjustSpacer();
});

addon.port.on("insertTreeNode", function(data, referenceId, after) {
    var $tree = $('#sessionTree');

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

    validateTree();
    adjustSpacer();
});

addon.port.on("moveTreeNode", function(id, referenceId, position) {
    var $tree = $('#sessionTree');

    var node = $tree.tree('getNodeById', id);
    if (!node) {
        console.error("node not found!");
        return;
    }

    var referenceNode = $tree.tree('getNodeById', referenceId);
    if (!referenceNode) {
        console.error("referenceNode not found!");
        return;
    }

    $tree.tree('moveNode', node, referenceNode, position);

    validateTree();
    adjustSpacer();
});

// ****************************************************************************
// TEST:

addon.port.on("updateTreeData", function(data) {
    $("#treeData").text(JSON.stringify(data, undefined, 2));
});
