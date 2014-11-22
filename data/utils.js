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

function isContainer(node) {
    if (node.type == "text" ||
        node.type == "separator")
    {
        return false;
    }

    return true;
}

function isTabContainer(node) {
    if (node.type == "window" ||
        node.type == "group")
    {
        return true;
    }

    return false;
}

function hasChildren(node) {
    if (!isContainer(node)) {
        return false;
    }

    return (node.children.length > 0);
}

function isActive(node) {
    return ("active" in node) && node.active;
}

function isActiveTab(node) {
    return (node.type == "tab") && isActive(node);
}

function isActiveWindow(node) {
    return (node.type == "window") && isActive(node);
}

function isSelected(node) {
    return ("selected" in node) && node.selected;
}

function isPinned(node) {
    return ("pinned" in node) && node.pinned;
}

function getWindowNode(node) {
    var currentNode = node;

    while (currentNode) {
        if (isTabContainer(currentNode)) {
            return currentNode;
        }

        currentNode = currentNode.parent;
    }

    return null;
}

var Traverse = {
    TERMINATE:     0,
    CONTINUE:      1,
    SKIP_CHILDREN: 2
};

function traverse(callback, containerNode, opt) {
    opt || (opt = { });

    if (typeof callback !== "function") {
        throw new Error("Expected a function as argument.");
    }

    var skipNodePredicate = opt.skipNodePredicate || null;

    // recursive tree walker
    var traverseNode = function(currentNode) {
        //[ skip node?
        if (skipNodePredicate && skipNodePredicate(currentNode)) {
            return Traverse.CONTINUE;
        }
        //]

        var result;
        try {
            result = callback(currentNode);
            if (result != Traverse.CONTINUE) {
                return result;
            }
        } catch (e) {
            alert(e);
        }

        // start new recursion?
        if (isContainer(currentNode) && hasChildren(currentNode)) {
            var children = currentNode.children;

            for (var i = 0, len = children.length; i < len; ++i) {
                result = traverseNode(children[i]);
                if (result == Traverse.TERMINATE) {
                    return result; // stop recursion
                }
            }
        }

        return Traverse.CONTINUE;
    };

    return traverseNode(containerNode);
}

function matchNodes(predicate, containerNode, opt) {
    var results = [];
    var search = function(node) {
        if (predicate(node)) {
            results.push(node);
        }

        return Traverse.CONTINUE; // continue
    }

    traverse(search, containerNode, opt);
    return results;
}

function filterNestedWindows(groupNode) {
    return {
        containerNode: groupNode,
        skipNodePredicate: function(currentNode) {
            return ((isTabContainer(currentNode)) &&
                    (currentNode !== groupNode));
        }
    };
}

function getDescendants(windowNode) {
    var descendants = [];

    traverse(function(currentNode) {
        if (currentNode === windowNode) {
            return Traverse.CONTINUE;
        }

        descendants.push(currentNode);

        if (isTabContainer(currentNode)) {
            return Traverse.SKIP_CHILDREN;
        } else {
            return Traverse.CONTINUE;
        }
    }, windowNode);

    return descendants;
}

function isEmpty(obj) {
    for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
            return false;
        }
    }

    return true;
}
