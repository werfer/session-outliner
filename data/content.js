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

$(function() {
    var $tree = $('#sessionTree');

    function hideHoverMenu() {
        $tree.find('.hmenu').each(function () {
            $(this).css('visibility', 'hidden');
        });
    }

    $tree.mouseleave(hideHoverMenu);

    $tree.tree({
        data: [],
        autoOpen: false,
        dragAndDrop: true,
        onCreateLi: function(node, $li) {
            $li.find('.jqtree-element').before(
                '<div class="hmenu">' +
                '<span class="hmenu-panel">' +
                '<span class="hmenu-button delete-action" data-node-id="' + node.id + '"></span>' +
                '<span class="hmenu-button close-action" data-node-id="' + node.id + '"></span>' +
                '</span>' +
                '</div>'
            );

            $li.find('.jqtree-element').mouseenter(function () {
                hideHoverMenu();
                $(this).prev().css('visibility', 'visible');
            });

            if ("active" in node && !node.active) {
                $li.addClass("inactive-node");
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
            return true;
        },
        onCanMoveTo: function(moved_node, target_node, position) {
            return true;
        }
    });

    // Handle a click on the delete link
    $tree.on(
        'click', '.delete-action',
        function(e) {
            // Get the id from the 'node-id' data property
            var node_id = $(e.target).data('node-id');

            // Get the node from the tree
            var node = $tree.tree('getNodeById', node_id);

            if (node) {
                var detach = ("is_open" in node) && node.is_open;
                addon.port.emit("treeEvent", "removeNode", node_id, detach);
            }
        }
    );

    $tree.on(
        'click', '.close-action',
        function(e) {
            // Get the id from the 'node-id' data property

            var node_id = $(e.target).data('node-id');
            var node = $tree.tree('getNodeById', node_id);
            if (node) {
                var withSubNodes = ("is_open" in node) && !node.is_open;
                addon.port.emit("treeEvent", "closeNode", node_id, withSubNodes);
            }
        }
    );

    $('#sessionTree').bind(
        'tree.dblclick',
        function(e) {
            addon.port.emit("treeEvent", "activateNode", e.node.id);
        }
    );

    function handleToggle(e) {
        addon.port.emit("treeEvent", "nodeToggle", e.node.id, e.node.is_open);
    }

    $('#sessionTree').bind(
        'tree.open',
        handleToggle
    );

    $('#sessionTree').bind(
        'tree.close',
        handleToggle
    );

    $('#sessionTree').bind(
        'tree.move',
        function(event) {
            event.preventDefault();
            var nodeId   = event.move_info.moved_node.id;
            var targetId = event.move_info.target_node.id;
            var position = event.move_info.position;
            addon.port.emit("treeEvent", "moveNode", nodeId, targetId, position);
        }
    );

    $(".test").click(function() {
        addon.port.emit("test", $(this).attr("id"));
    });

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

    $(".mainMenuLink").click(function() {
        var action   = $(this).attr("id");
        var node     = $tree.tree('getSelectedNode');
        var targetId;

        if (!!node == false) {
            var rootNode    = $('#sessionTree').tree('getTree');
            var sessionNode = rootNode.children[0];
            targetId = sessionNode.id;
        } else {
            targetId = node.id;
        }

        addon.port.emit("menuEvent", action, targetId);
    });

    $("#update").click(function() {
        addon.port.emit("update");
    });

    window.onresize = adjustSpacer;

    // request tree
    addon.port.emit("ready");
});

// ****************************************************************************

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

function loadChildren(node, data) {
    if ("children" in data) {
        var $tree = $('#sessionTree');
        $tree.tree('loadData', data.children, node);
        return;
    }
}

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

// ----------------------------------------------------------------------------

addon.port.on("updateTreeData", function(data) {
    var $tree = $('#sessionTree');
    $tree.tree('loadData', [data]);
    adjustSpacer();
});

addon.port.on("updateTreeNode", function(id, data) {
    var $tree = $('#sessionTree');

    var node = $tree.tree('getNodeById', id);
    if (!node) {
        console.error("error node not found!");
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
        console.error("error node not found!");
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
        console.error("error node not found!");
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
        console.error("error node not found!");
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
        console.error("error referenceNode not found!");
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
        console.error("error node not found!");
        return;
    }

    var referenceNode = $tree.tree('getNodeById', referenceId);
    if (!referenceNode) {
        console.error("error referenceNode not found!");
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
