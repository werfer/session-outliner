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
const windowUtils = require('sdk/window/utils');
const tabUtils = require('sdk/tabs/utils');
const _ = require("sdk/l10n").get;

const { Class } = require("classy/classy");

const {
    defaultTitle,
    adoptTabState,
    setTabStateFromNode,
    openBrowser,
} = require("browser");

const {
    assert,
    clone,
    InvalidOperationError
} = require("utils");

const {
    browserObserver,
    TabStateNotification
} = require("observer");

const {
    Position,
    Traverse,
    ModelIndex,
    AbstractNode,
    AbstractGroupNode,
    TreeModel
} = require("treemodel");

// ****************************************************************************
const ID_PROPERTY = "_outlinerId";

// ****************************************************************************
// nodes:

let MetadataMixin = {
    getMetadata: function() {
        let metadata = this._metadata || (this._metadata = { });
        return metadata;
    },

    putEntry: function(entry) {
        let metadata = this.getMetadata();
        metadata[entry.key] = entry.value;
    },

    removeEntry: function(key) {
        if (this._metadata) {
            delete metadata[key];
        }
    },

    hasEntry: function(key) {
        let metadata = this.getMetadata();
        return (key in metadata);
    },

    getValue: function(key) {
        let metadata = this.getMetadata();
        return metadata[key];
    },

    serializeMetadata: function() {
        let metadata = this.getMetadata();
        return clone(metadata);
    },

    deserializeMetadata: function(metadata) {
        this._metadata = clone(metadata);
    }
};

let SessionNode = AbstractGroupNode.$extend({
    __include__: [MetadataMixin],

    __classvars__: {
        SERIALIZABLE: ["_sessionName"]
    },

    __init__: function(config) {
        config || (config = { });
        config.data || (config.data = {
            _sessionName: _("Current Session")
        });

        this.$super(config);
    },

    getLabel: function() {
        return this._sessionName;
    },

    setLabel: function(name) {
        this._sessionName = name;
    },

    typename: function() {
        return "SessionNode";
    },

    toString: function() {
        return "[SessionNode | children: " + this._children.length + "]";
    }
});
module.exports.SessionNode = SessionNode;

let TextNode = AbstractNode.$extend({
    __include__: [MetadataMixin],

    __classvars__: {
        SERIALIZABLE: ["_label"]
    },

    __init__: function(config) {
        config || (config = { });
        config.data || (config.data = {
            _label: "#"
        });

        this.$super(config);
    },

    getLabel: function() {
        return this._label;
    },

    setLabel: function(label) {
        this._label = label;
    },

    serialize: function() {
        let obj = this.$super();
        obj["metadata"] = this.serializeMetadata();
        
        return obj;
    },

    typename: function() {
        return "TextNode";
    },

    toString: function() {
        return "[TextNode | label: " + this._label + "]";
    }
});
module.exports.TextNode = TextNode;

let SeparatorNode = AbstractNode.$extend({
    __include__: [MetadataMixin],

    __classvars__: {
        SERIALIZABLE: ["_style"]
    },

    __init__: function(config) {
        config || (config = { });
        config.data || (config.data = {
            _style: "continuous"
        });

        this.$super(config);
    },

    serialize: function() {
        let obj = this.$super();
        obj["metadata"] = this.serializeMetadata();
        
        return obj;
    },

    getStyle: function() {
        return this._style;
    },

    setStyle: function(style) {
        this._style = style;
    },
    
    typename: function() {
        return "SeparatorNode";
    },

    toString: function() {
        return "[SeparatorNode]";
    }
});
module.exports.SeparatorNode = SeparatorNode;

let WindowNode = AbstractGroupNode.$extend({
    __include__: [MetadataMixin],

    __classvars__: {
        SERIALIZABLE: ["_windowName"]
    },

    /**
     * @param {config} optional
     */
    __init__: function(config) {
        this.$super(config);

        if (config.hasOwnProperty("metadata")) {
            this.deserializeMetadata(config["metadata"]);
        }
    },

    getLabel: function() {
        return this._windowName;
    },

    setLabel: function(name) {
        this._windowName = name;
        this.putEntry({
            key: "customized",
            value: true
        });
    },

    serialize: function() {
        let obj = this.$super();
        obj["metadata"] = this.serializeMetadata();
        
        return obj;
    },

    isActivatable: function() {
        let isGroup = this.hasEntry("isGroup") && this.getValue("isGroup");
        return !isGroup;
    },

    isActive: function() {
        return false;
    },

    isGroup: function() {
        let isGroup = this.hasEntry("isGroup") && this.getValue("isGroup");
        return isGroup;
    },

    isPersistent: function() {
        let persistent;
        let isGroup = this.hasEntry("isGroup") && this.getValue("isGroup");
        let customized = this.hasEntry("customized") && this.getValue("customized");

        persistent = isGroup || customized;
        return persistent;
    },

    typename: function() {
        return "WindowNode";
    },

    toString: function() {
        return "[WindowNode | name: " + this._windowName +
               " | children: " + this._children.length + "]";
    }
});
module.exports.WindowNode = WindowNode;

let ActiveWindowNode = WindowNode.$extend({
    __init__: function(domWindow, config) {
        config || (config = { });
        config.data || (config.data = {
            _windowName: _("Window")
        });

        this.$super(config);

        this._domWindow = domWindow;
    },

    _setId: function(id) {
        this.$super(id);

        if (this._domWindow) {
            this._domWindow[ID_PROPERTY] = id;
        }
    },

    /**
     * close associated browser resources
     */
    closeSilently: function() {
        let window = this._domWindow;

        //[ close window
        browserObserver.installEventFilter(function(val, i, t) {
            if (val.type != "windowClose") {
                return true;
            }

            let keep = (val.arguments[0] !== window);
            return keep;
        }, true);

        window.close();
        //]

        this._domWindow = null;
    },

    focus: function() {
        this._domWindow.focus();
    },

    getWindow: function() {
        return this._domWindow;
    },

    toDeactivatedNode: function() {
        //[ close tabs recursively
        let closeTabNode = function closeTabNodeFunc(currentNode) {
            //[ only tab nodes within the same window need to be closed
            if (!currentNode.isContainer()) {
                return currentNode; // keep old node
            }

            if (currentNode instanceof WindowNode) {
                return currentNode;
            }
            //]

            let subChildNodes = [];
            if (currentNode.isContainer() && currentNode.hasChildren()) {
                currentNode.forEach(function(childNode) {
                    let newChildNode = closeTabNodeFunc(childNode);
                    subChildNodes.push(newChildNode);
                });
            }

            // create new node
            let newNode = TabNode({
                data: currentNode,
                children: subChildNodes,
                metadata: currentNode.serializeMetadata()
            });

            return newNode;
        };

        let newChildNodes = [];
        this.forEach(function(currentNode) {
            let newChildNode = closeTabNode(currentNode);
            newChildNodes.push(newChildNode);
        });
        //]

        let node = WindowNode({
            data: this,
            children: newChildNodes,
            metadata: this.serializeMetadata()
        });

        return node;
    },

    isActivatable: function() {
        return false;
    },

    isActive: function() {
        return true;
    },

    typename: function() {
        return "ActiveWindowNode";
    },

    toString: function() {
        return "[ActiveWindowNode | name: " + this._windowName +
               " | children: " + this._children.length + "]";
    }
});
module.exports.ActiveWindowNode = ActiveWindowNode;

let TabNode = AbstractGroupNode.$extend({
    __include__: [MetadataMixin],

    __classvars__: {
        SERIALIZABLE: ["_url", "_title", "_favicon", "_isPinned"]
    },

    __init__: function(config) {
        this.$super(config);

        if (config.hasOwnProperty("metadata")) {
            this.deserializeMetadata(config["metadata"]);
        }
    },

    // TODO opener id

    getUrl: function() {
        return this._url;
    },

    getTitle: function() {
        return this._title;
    },

    getFavicon: function() {
        return this._favicon;
    },

    serialize: function() {
        let obj = this.$super();
        obj["metadata"] = this.serializeMetadata();
        
        return obj;
    },

    isPinned: function() {
        return this._isPinned;
    },

    isActivatable: function() {
        let windowNode = getWindowNode(this);
        return (windowNode.isActive() ||  windowNode.isActivatable());
    },

    isActive: function() {
        return false;
    },

    typename: function() {
        return "TabNode";
    },

    toString: function() {
        return "[TabNode | last URL: " + this._url +
               " | children: " + this._children.length + "]";
    }
});
module.exports.TabNode = TabNode;

let ActiveTabNode = TabNode.$extend({
    __init__: function(domTab, config) {
        config || (config = { });
        this.$super(config);

        this._domTab = domTab;
    },

    _setId: function(id) {
        this.$super(id);

        if (this._domTab) {
            this._domTab[ID_PROPERTY] = id;
        }
    },

    /**
     * close associated browser resources
     */
    closeSilently: function() {
        let tab = this._domTab;
        let windowNode = getWindowNode(this);
        let tabbrowser = windowNode.getWindow().gBrowser;

        if (tabbrowser.tabs.length == 1) {
            throw new InvalidOperationError("Only one tab left.");
        }

        //[ remove tab
        browserObserver.stopProcessing();
        tabbrowser.removeTab(tab);

        browserObserver.filterPendingEvents(function(val, i, t) {
            if (val.type != "tabClose") {
                return true;
            }

            let keep = (val.arguments[0] !== tab);
            return keep;
        });

        browserObserver.resumeProcessing();
        //]

        this._domTab = null;
    },

    focus: function() {
        let windowNode = getWindowNode(this);
        tabUtils.activateTab(this._domTab, windowNode.getWindow());
        windowNode.focus();
    },

    getTab: function() {
        return this._domTab;
    },

    setTab: function(domTab) {
        this._domTab = domTab;
        this._domTab[ID_PROPERTY] = this.getId();
    },

    swapTabs: function(otherNode) {
        let otherTab = otherNode._domTab;

        otherNode.setTab(this._domTab);
        this.setTab(otherTab);
    },

    getTabIndex: function() {
        return tabUtils.getIndex(this._domTab);
    },

    isActivatable: function() {
        return false;
    },

    isSelected: function() {
        return this._domTab.selected;
    },

    isPending: function() {
        return this._domTab.hasAttribute("pending");
    },

    toDeactivatedNode: function() {
        let node = TabNode({
            data: this,
            children: this.getChildren(),
            metadata: this.serializeMetadata()
        });

        return node;
    },

    updateState: function(state) {
        this._isPinned = this._domTab.pinned;

        if (!!state == false) {
            return;
        }

        if (state == TabStateNotification.LOAD) {
            this._favicon = "chrome://global/skin/icons/loading_16.png";
            this._title = _("connecting...");
        } else if (state == TabStateNotification.LOCATION) {
            this._url = tabUtils.getTabURL(this._domTab);
            this._title = defaultTitle(this._url);
        } else if (state == TabStateNotification.STOP) {
            this._url = tabUtils.getTabURL(this._domTab);
            this._title = tabUtils.getTabTitle(this._domTab);

            if (this._domTab.image) {
                this._favicon = this._domTab.image;
            } else {
                this._favicon = "chrome://mozapps/skin/places/defaultFavicon.png";
            }
        }
    },

    isActive: function() {
        return true;
    },

    typename: function() {
        return "ActiveTabNode";
    },

    toString: function() {
        return "[ActiveTabNode | position: " + this.getParent().getPosition(this) +
               " | tab index: " + this.getTabIndex() +
               " | last URL: " + this._url +
               " | last Title: " + this._title +
               " | children: " + this._children.length + "]";
    }
});
module.exports.ActiveTabNode = ActiveTabNode;

// ****************************************************************************
// standalone utils:

/**
 * @param {DOMElement} object nsIDOMWindow or nsIDOMNode
 */
function hasId(object) {
    if (object.hasOwnProperty(ID_PROPERTY)) {
        let id = object[ID_PROPERTY];
        return (!!id != false);
    }

    return false;
}

function getWindowNode(node) {
    var currentNode = node;

    while (currentNode) {
        if (currentNode instanceof WindowNode) {
            return currentNode;
        }

        currentNode = currentNode.getParent();
    }

    return null;
}
module.exports.getWindowNode = getWindowNode;

function getTopMostTabNode(node) {
    assert(node instanceof TabNode, "The node should be an instance of TabNode.");

    let currentNode = node;
    let nextParent  = node.getParent();
    assert(nextParent, "Abandoned tab node.");

    while (nextParent instanceof TabNode) {
        currentNode = nextParent;
        nextParent  = currentNode.getParent();
        assert(nextParent, "Abandoned tab node.");
    }

    return currentNode;
}
module.exports.getTopMostTabNode = getTopMostTabNode;

function sortTabs(windowNode) {
    assert(windowNode instanceof WindowNode, "Expected WindowNode.");

    let model = windowNode.getModel();
    let tabbrowser = windowNode.getWindow().gBrowser;

    //[ sort tabs
    let activeTabNodes = model.getActiveTabNodes(windowNode);

    activeTabNodes.forEach(function(currentNode) {
        let tab = currentNode.getTab();
        let newTdx = model.modelPositionToTabIndex(currentNode);
        let currentTdx = currentNode.getTabIndex();
        
        if (newTdx == currentTdx) {
            return; // nothing to do
        }

        browserObserver.stopProcessing();

        tabbrowser.moveTabTo(tab, newTdx);
        browserObserver.filterPendingEvents(function(val, i, t) {
            if (val.type != "tabMove") {
                return true;
            }

            let keep = (val.arguments[0] !== tab)
            return keep;
        });

        browserObserver.resumeProcessing();
    });
    //]
}

// ----------------------------------------------------------------------------

function openBrowserFailure() {
    console.error("Failed to open browser window.");
    browserObserver.resumeProcessing();
}

function activateWindow(oldWindowNode) {
    let model = oldWindowNode.getModel();

    if (!oldWindowNode.isActivatable()) {
        return; // nothing to do
    }

    // the old node will be replaced
    let tabNodes = model.getTabNodes(oldWindowNode);
    if (tabNodes.length < 1) {
        // create new TabNode
        let newNode = createHomeNode();
        model.appendNode(newNode, oldWindowNode.getIndex());
        tabNodes.push(newNode);
    }

    // suspend event processing
    browserObserver.stopProcessing();

    let firstTabNode = tabNodes[0];
    openBrowser(firstTabNode.getUrl()).then(function success(window) {
        let tabs = [];
        let tabbrowser = window.gBrowser;

        //[ recursive tab activation
        let activateTabNode = function activateTabNodeFunc(currentNode) {
            // only tab nodes within the same window need to be activated
            if (!(currentNode instanceof TabNode)) {
                return currentNode; // keep old node
            }

            let subChildNodes = [];

            //[ set up tab
            let tab;
            if (currentNode === firstTabNode) {
                tab = tabbrowser.tabContainer.childNodes[0];
            } else {
                tab = tabbrowser.addTab(null);
                setTabStateFromNode(tab, currentNode);
            }
            tabs.push(tab);

            if (currentNode.isPinned()) {
                tabbrowser.pinTab(tab);
            }
            //]

            if (currentNode.isContainer() && currentNode.hasChildren()) {
                currentNode.forEach(function(childNode) {
                    if (childNode instanceof TabNode) {
                        let newChildNode = activateTabNodeFunc(childNode);
                        subChildNodes.push(newChildNode);
                    } else {
                        subChildNodes.push(childNode);
                    }
                });
            }

            // create new node
            let newNode = ActiveTabNode(tab, {
                data: currentNode,
                children: subChildNodes,
                metadata: currentNode.serializeMetadata()
            });

            return newNode;
        };

        let newChildNodes = [];
        oldWindowNode.forEach(function(currentNode) {
            let newChildNode = activateTabNode(currentNode);
            newChildNodes.push(newChildNode);
        });
        //]

        //[ set up window node
        let newWindowNode = ActiveWindowNode(window, {
            data: oldWindowNode,
            children: newChildNodes,
            metadata: oldWindowNode.serializeMetadata()
        });

        model.replaceNode(oldWindowNode, newWindowNode);
        //]

        browserObserver.filterPendingEvents(function(val, i, t) {
            let keep = true;
            switch (val.type) {
            case "windowOpen":
                keep = (val.arguments[0] !== window);
                break;
            case "tabOpen":
                keep = (tabs.indexOf(val.arguments[0]) < 0);
                break;
            case "aboutToPin":
            case "aboutToUnpin":
            case "tabStateChanged":
                keep = false;
                break;
            }

            return keep;
        });
        browserObserver.resumeProcessing();

        tabs.length = 0;
    }, openBrowserFailure);
}
module.exports.activateWindow = activateWindow;

function activateWindowWithTab(windowNode, oldTabNode) {
    let model = windowNode.getModel();

    // suspend event processing
    browserObserver.stopProcessing();

    openBrowser(oldTabNode.getUrl()).then(function success(window) {
        let tabbrowser = window.gBrowser;

        //[ set up tab
        let tab = tabbrowser.selectedTab;
        if (oldTabNode.isPinned()) {
            tabbrowser.pinTab(tab);
        }

        let newTabNode = ActiveTabNode(tab, {
            data: oldTabNode,
            children: oldTabNode.getChildren(),
            metadata: oldTabNode.serializeMetadata()
        });
        //]

        //[ set up window node
        let newWindowNode = ActiveWindowNode(window, {
            data: windowNode,
            children: windowNode.getChildren(),
            metadata: windowNode.serializeMetadata()
        });

        model.replaceNode(windowNode, newWindowNode);
        model.replaceNode(oldTabNode, newTabNode);
        //]

        browserObserver.filterPendingEvents(function(val, i, t) {
            let keep = true;
            switch (val.type) {
            case "windowOpen":
                keep = (val.arguments[0] !== window);
                break;
            case "aboutToPin":
            case "aboutToUnpin":
            case "tabStateChanged":
                keep = false;
                break;
            }

            return keep;
        });
        browserObserver.resumeProcessing();
    }, openBrowserFailure);
}

/**
 * the old node will be replaced
 */
function activateTab(oldTabNode) {
    let model = oldTabNode.getModel();

    if (oldTabNode instanceof ActiveTabNode || !oldTabNode.isActivatable()) {
        return; // nothing to do
    }

    let windowNode = getWindowNode(oldTabNode);
    assert(windowNode, "Invalid containment of tab node.");

    if (!windowNode.isActive()) {
        activateWindowWithTab(windowNode, oldTabNode);
        return;
    }

    let tabbrowser = windowNode.getWindow().gBrowser;

    //[ suspend event processing
    browserObserver.stopProcessing();

    //[ set up tab
    let tab = tabbrowser.addTab(oldTabNode.getUrl());
    if (oldTabNode.isPinned()) {
        tabbrowser.pinTab(tab);
    }

    let newTabNode = ActiveTabNode(tab, {
        data: oldTabNode,
        children: oldTabNode.getChildren(),
        metadata: oldTabNode.serializeMetadata()
    });

    model.replaceNode(oldTabNode, newTabNode);
    //]

    //[ determine tab index
    let nodeTdx = model.modelPositionToTabIndex(newTabNode);
    tabbrowser.moveTabTo(tab, nodeTdx);
    //]

    browserObserver.filterPendingEvents(function(val, i, t) {
        let keep = true;
        switch (val.type) {
        case "tabOpen":
            keep = (val.arguments[0] !== tab);
            break;
        case "tabMove":
            keep = (val.arguments[0] !== tab);
            break;
        case "aboutToPin":
        case "aboutToUnpin":
            keep = false;
            break;
        }

        return keep;
    });
    //]

    browserObserver.resumeProcessing();
}
module.exports.activateTab = activateTab;

// ----------------------------------------------------------------------------

function deleteTabNode(node, detach) {
    let model = node.getModel();
    let index = node.getIndex();
    let windowNode = getWindowNode(node);
    assert(windowNode, "Abandoned tab node.");

    if (detach) {
        model.detachAll(node);
    } else {
        //[ close windows
        let activeWindowNodes = model.getActiveWindowNodes(node);

        for (let i = activeWindowNodes.length; i-- > 0;) {
            let currentNode = activeWindowNodes[i];
            currentNode.closeSilently();
        }
        //]
    }

    //[ close tab(s)
    let windowActiveTabCount = model.getActiveTabCount(windowNode);
    let activeTabNodes = model.getActiveTabNodes(node);

    model.removeNode(index);

    // the window can be closed
    if (windowActiveTabCount == activeTabNodes.length &&
        windowNode.isActive())
    {
        model.closeNode(windowNode);
    } else {
        for (let i = activeTabNodes.length; i-- > 0;) {
            let currentNode = activeTabNodes[i];
            currentNode.closeSilently();
        }
    }
    //]

    let parentNode = model.getNode(index.getParent());
    handleEmptyWindow(parentNode);
}
module.exports.deleteTabNode = deleteTabNode;

function deleteWindowNode(node, detach) {
    let model = node.getModel();
    let index = node.getIndex();

    if (detach) {
        model.detachChildren(node, function(currentNode) {
            return !(currentNode instanceof TabNode);
        });
    }

    let activeWindowNodes = model.getActiveWindowNodes(node);
    model.removeNode(index);

    for (let i = activeWindowNodes.length; i-- > 0;) {
        let currentNode = activeWindowNodes[i];
        currentNode.closeSilently();
    }

    let parentNode = model.getNode(index.getParent());
    handleEmptyWindow(parentNode);
}
module.exports.deleteWindowNode = deleteWindowNode;

// ----------------------------------------------------------------------------

/**
 * @param {Node} node The window node or a direct descendant
 */
function handleEmptyWindow(node) {
    let model = node.getModel();

    let windowNode = getWindowNode(node);
    if (!windowNode) {
        return; // nothing to do
    }

    let childCount = model.countSubNodes(windowNode);
    let persistent = windowNode.isPersistent();
    if (childCount == 0 && !persistent) {
        deleteWindowNode(windowNode, false); // there is nothing to detach
        return;
    }
}

// ----------------------------------------------------------------------------

/**
 * @param {tabbrowser} target browser
 */
function transferTab(oldTab, tabbrowser) {
    if (!oldTab.parentNode) {
        return null;
    }

    let newTab = tabbrowser.addTab();
    newTab.linkedBrowser.stop();
    newTab.linkedBrowser.docShell; // make sure it has a docshell

    // FIXME
    if (false) {//oldTab.hasAttribute("pending")) {
        console.log("*** transferTab() tab is pending");
        adoptTabState(oldTab, newTab);
        tabUtils.closeTab(oldTab);
    } else {
        tabbrowser.swapBrowsersAndCloseOther(newTab, oldTab);
        tabbrowser.setTabTitle(newTab);
    }

    return newTab;
}

function moveTabBranch(tabNode, srcWindowNode, dstWindowNode) {
    let model = tabNode.getModel();
    let tabbrowser = dstWindowNode.getWindow().gBrowser;

    //[ transfer tabs
    if (srcWindowNode !== dstWindowNode) {
        // add new tab, swap docshells
        console.log("transfering tabs");

        // get active tab nodes within the same window
        let activeNodes = model.getActiveTabNodes(tabNode);
        activeNodes.forEach(function(currentNode) {
            browserObserver.stopProcessing();

            // There seems to be a bug in swapBrowsersAndCloseOther() with pending tabs.
            // Further investigation is needed on this issue.
            //[ Workaround
            if (currentNode.isPending()) {
                currentNode.focus();
            }
            //]

            let isPinned = currentNode.isPinned();
            let tab = currentNode.getTab();
            let newTab = transferTab(tab, tabbrowser);
            currentNode.setTab(newTab);

            if (isPinned) {
                tabbrowser.pinTab(newTab);
            }

            browserObserver.filterPendingEvents(function(val, i, t) {
                let keep = true;
                switch (val.type) {
                case "swapTabs":
                    keep = (val.arguments[0] !== tab) &&
                           (val.arguments[1] !== tab);
                    break;
                case "tabOpen":
                    keep = false; // ignore tabs opened by swapBrowsersAndCloseOther()
                    break;
                case "tabClose":
                    keep = (val.arguments[0] !== tab)
                    break;
                case "tabMove":
                    keep = (val.arguments[0] !== newTab)
                    break;
                }

                return keep;
            });

            browserObserver.resumeProcessing();
        });
    }
    //]

    // sort tabs within the browser window
    sortTabs(dstWindowNode);
}

// ----------------------------------------------------------------------------

/**
 * @param {Node} groupNode A window node or one of its descendants.
 */
function filterNestedWindows(groupNode) {
    return {
        containerNode: groupNode,
        skipNodePredicate: function(currentNode) {
            return ((currentNode instanceof WindowNode) &&
                    (currentNode !== groupNode)); // in case that groupNode refers to an instance of WindowNode
        }
    };
}

function filterNestedContainers(groupNode) {
    return {
        containerNode: groupNode,
        skipNodePredicate: function(currentNode) {
            return ((currentNode.isContainer()) &&
                    (currentNode !== groupNode)); // filter only nested containers
        }
    };
}

module.exports.Filters = {
    filterNestedWindows: filterNestedWindows,
    filterNestedContainers: filterNestedContainers
};

// ----------------------------------------------------------------------------

function createHomeNode() {
    let node = TabNode({
        data: {
            _url: "about:home",
            _title: "home",
            _favicon: "chrome://mozapps/skin/places/defaultFavicon.png"
        }
    });

    return node;
}
module.exports.createHomeNode = createHomeNode;

// ****************************************************************************
// observer event handlers:

function observerWindowOpenHandler(event, window) {
    let model = event.subject;

    // window should not be in model
    assert(!model.hasWindow(window), "Window already in model.");

    // create tab nodes
    let children = [];
    let tabs = tabUtils.getTabs(window);
    for (let i = 0, len = tabs.length; i < len; ++i) {
        let tab = tabs[i];
        let tabNode = ActiveTabNode(tab);
        tabNode.updateState(TabStateNotification.STOP);

        children.push(tabNode); // retain window order
    }

    let parentIndex = model.getRootNode().getIndex();
    let windowNode = ActiveWindowNode(window, {
        children: children
    });
    model.appendNode(windowNode, parentIndex);
}

function observerWindowCloseHandler(event, window) {
    let model = event.subject;

    let windowNode = model.getNodeForWindow(window);
    if (!windowNode) {
        console.warn("observerWindowCloseHandler: window node not found.");
        return false;
    }

    // keep window nodes with inactive tab nodes or child nodes like window nodes
    let nodes = model.matchNodes(function(currentNode) {
        return (!(currentNode instanceof ActiveTabNode) &&
                currentNode !== windowNode);
    }, { containerNode: windowNode });

    let persistent = windowNode.isPersistent();
    if (nodes.length > 0 || persistent) {
        let newNode = windowNode.toDeactivatedNode();
        model.replaceNode(windowNode, newNode);
    } else {
        model.removeNode(windowNode.getIndex());
    }
}

function observerTabOpenHandler(event, tab) {
    let model = event.subject;

    // tab should not be in model
    assert(!model.hasTab(tab), "Tab already in model.");

    let window = tabUtils.getOwnerWindow(tab); // DOM window
    let windowNode = model.getNodeForWindow(window);
    assert(windowNode, "Window node not found.");

    let tabNode = ActiveTabNode(tab);
    tabNode.updateState(TabStateNotification.STOP);

    //[ determine parent index
    let parentIndex = windowNode.getIndex();

    // the new tab was opened by another tab
    let suitableOpenerInfo   = (openerInfo != null && openerInfo.where == "tab");
    let treeStyleTabsEnabled = true; // TODO preference

    if (treeStyleTabsEnabled && suitableOpenerInfo) {
        let openerTab    = model.getNodeById(openerInfo.openerId);
        let openerParent = openerTab.getParent();
        assert(openerParent, "Opener parent node not found.");

        // this is the only case we can handle at this stage
        if (openerParent.back() == openerTab) {
            openerInfo  = null; // reset openerInfo
            parentIndex = openerTab.getIndex();
        }
    } else if (suitableOpenerInfo) {
        openerInfo = null; // reset
    }
    //]

    model.appendNode(tabNode, parentIndex);
}

function observerTabCloseHandler(event, tab, detail) {
    let model = event.subject;

    let tabNode = model.getNodeForTab(tab);
    assert(tabNode, "Tab not in model.");

    model.detachAll(tabNode);
    model.removeNode(tabNode.getIndex());
}

function observerTabSelect(event, tab) {
    let model = event.subject;

    let tabNode = model.getNodeForTab(tab);
    assert(tabNode, "Tab not in model.");

    model.emit("tabSelect", tabNode.getId());
}

/**
 * The default move policy is to move a node in front of its next sibling
 */
function observerTabMoveHandler(event, tab, oldTdx, newTdx) {
    assert(oldTdx != newTdx, "Tab position has not changed.");

    let model = event.subject;
    let tabNode = model.getNodeForTab(tab);
    assert(tabNode, "Tab not in model.");

    //[ determine tab position
    let windowNode = getWindowNode(tabNode);

    let nodeTdx = tabNode.getTabIndex();
    let nextTdx = nodeTdx + 1;

    // verify model state
    let modelTdx = model.modelPositionToTabIndex(tabNode);
    if (modelTdx == nodeTdx) {
        // nothing to do
        console.warn("Model is already up to date.");
        return tabNode;
    }

    // the user only wants to move the parent node
    if (tabNode.hasChildren()) {
        model.detachAll(tabNode);
    }

    let position;
    let referenceNode;
    let suitableOpenerInfo = (openerInfo != null && openerInfo.where == "tab");

    if (suitableOpenerInfo) {
        let parentNode = model.getNodeById(openerInfo.openerId);
        let parentTdx  = model.modelPositionToTabIndex(parentNode);
        assert(newTdx > parentTdx, "Invalid opener info.");

        let childCount = parentNode.getChildCount();
        if (childCount > 0) {
            let lastTdx;
            let lastNode;

            // referenceNode on the same level
            for (let i = 0; i < childCount; ++i) {
                lastNode = parentNode.getChild(i);

                // skip everything else
                if (!(lastNode instanceof ActiveTabNode)) {
                    continue;
                }

                lastTdx = lastNode.getTabIndex();
                if (lastTdx > newTdx) {
                    break;
                }
            }

            referenceNode = lastNode;
            if (lastTdx > newTdx) {
                position = Position.BEFORE;
            } else {
                position = Position.AFTER;
            }
        } else {
            referenceNode = parentNode;
            position = Position.INSIDE;
        }

        openerInfo = null; // reset
    } else {
        let nextActiveNode = model.getNodeByTabIndex(nextTdx, windowNode);
        if (nextActiveNode) {
            referenceNode = nextActiveNode;
            position = Position.BEFORE;
        } else {
            // move it to the end
            if (windowNode.hasChildren()) {
                referenceNode = windowNode.back();
                position = Position.AFTER;
            } else {
                referenceNode = windowNode;
                position = Position.INSIDE;
            }
        }
    }
    //]

    model.moveNode(tabNode.getIndex(), referenceNode.getIndex(), position);
}

function observerTabRestoring(event, tab) {
console.log("observerTabRestoring()");
    let model = event.subject;
    let tabNode;

    if (hasId(tab)) {
        tabNode = model.getNodeForTab(tab);
    } else {
        let parentWindow = tabUtils.getOwnerWindow(tab);
        let windowNode = model.getNodeForWindow(parentWindow);
        assert(windowNode, "Parent window not found.");

        // create a new node
        tabNode = ActiveTabNode(tab);

        //[ determine tab position
        let nextTdx = tabNode.getTabIndex() + 1;
        let nextActiveNode = model.getNodeByTabIndex(nextTdx, windowNode);
        if (nextActiveNode) {
            let parentNode = nextActiveNode.getParent();
            let position   = parentNode.getPosition(nextActiveNode);

            // insert before
            model.insertNode(tabNode, parentNode.getIndex(), position);
        } else {
            model.appendNode(tabNode, windowNode.getIndex());
        }
        //]
    }

    model.updateNode(tabNode, function(node) {
        node.updateState(TabStateNotification.STOP);
    });
}

function observerSwapTabContents(event, tab1, tab2) {
    let model = event.subject;
console.log("*** is pending: " + tab1.hasAttribute("pending"));
console.log("*** is pending: " + tab2.hasAttribute("pending"));

    let tabNode1 = model.getNodeForTab(tab1);
    model.detachAll(tabNode1);
    assert(tabNode1, "Node not in model.");

    let tabNode2 = model.getNodeForTab(tab2);
    model.detachAll(tabNode2);
    assert(tabNode2, "Node not in model.");

    // swap tabs
    tabNode1.swapTabs(tabNode2);
    model.swapNodes(tabNode1, tabNode2);
}

function observerTabStateChanged(event, tab, state) {
    let model = event.subject;

    if (!hasId(tab)) {
        return;
    }

    let tabNode = model.getNodeForTab(tab);
    model.updateNode(tabNode, function(node) {
        node.updateState(state);
    });

    if (state == TabStateNotification.PINNED ||
        state == TabStateNotification.UNPINNED)
    {
        let windowNode = getWindowNode(tabNode);
        if (!windowNode.hasChildren()) {
            return;
        }

        let position;
        let targetNode;
        let index = tabNode.getIndex();

        if (state == TabStateNotification.PINNED) {
            position = Position.BEFORE;
            targetNode = windowNode.front();
        } else {
            position = Position.AFTER;
            targetNode = windowNode.back();
        }

        if (targetNode === tabNode) {
            return; // nothing to do
        }

        model.moveNode(index, targetNode.getIndex(), position);
    }
}

function observerAboutToChangePinState(event, tab) {
    let model = event.subject;

    if (hasId(tab)) {
        let tabNode = model.getNodeForTab(tab);
        model.detachAll(tabNode);
    }
}

// Data about opener tab
let openerInfo = null;

function observerOpenLinkInHandler(event, selectedTab, url, where, params) {
    if (where != "tab" && where != "window") {
        return;
    }

    if (params.hasOwnProperty("fromChrome") || selectedTab.pinned) {
        return;
    }

    if (!hasId(selectedTab)) {
        console.warn("Id property not defined.");
        return;
    }

    let tabId = selectedTab[ID_PROPERTY];
    console.log("Current tab id:", tabId);

    openerInfo = {
        openerId: tabId,
        where: where
    };
}

// ****************************************************************************
// TabModel:

let TabModel = TreeModel.$extend({
    __init__: function() {
        let sessionNode = SessionNode();
        this.$super(sessionNode);

        this._attachEventHandlers();
        browserObserver.connect();

        this._addActiveNodes();
    },

    _attachEventHandlers: function() {
        browserObserver.port.on( "tabOpen",
                                 observerTabOpenHandler,
                                 this );
        browserObserver.port.on( "tabClose",
                                 observerTabCloseHandler,
                                 this );
        browserObserver.port.on( "tabSelect",
                                 observerTabSelect,
                                 this );
        browserObserver.port.on( "tabMove",
                                 observerTabMoveHandler,
                                 this );
        browserObserver.port.on( "tabRestoring",
                                 observerTabRestoring,
                                 this );
        browserObserver.port.on( "tabStateChanged",
                                 observerTabStateChanged,
                                 this );
        browserObserver.port.on( "swapTabs",
                                 observerSwapTabContents,
                                 this );
        browserObserver.port.on( "windowOpen",
                                 observerWindowOpenHandler,
                                 this );
        browserObserver.port.on( "windowClose",
                                 observerWindowCloseHandler,
                                 this );
        browserObserver.port.on( "aboutToPin",
                                 observerAboutToChangePinState,
                                 this );
        browserObserver.port.on( "aboutToUnpin",
                                 observerAboutToChangePinState,
                                 this );
        browserObserver.port.on( "openLinkIn",
                                 observerOpenLinkInHandler,
                                 this );
    },

    _detachEventHandlers: function() {
        browserObserver.disconnect();
        browserObserver.port.removeAllListeners();
    },

    _addActiveNodes: function() {
        console.log("_addActiveNodes()");
        let parentIndex = this.getRootNode().getIndex();

        // create window nodes
        let windows = windowUtils.windows("navigator:browser");
        for (let i = 0, len1 = windows.length; i < len1; ++i) {
            let window = windows[i];

            // create tab nodes
            let children = [];
            let tabs = tabUtils.getTabs(window);
            for (let j = 0, len2 = tabs.length; j < len2; ++j) {
                let tab = tabs[j];
                let tabNode = ActiveTabNode(tab);
                tabNode.updateState(TabStateNotification.STOP);

                children.push(tabNode); // retain tab order
            }

            let windowNode = ActiveWindowNode(window, {
                children: children
            });
            this.appendNode(windowNode, parentIndex);
        }
    },

    dispose: function() {
        this._detachEventHandlers();
    },

    deserializeNode: function(obj) {
        let type = obj.typename;
        let node;

        switch (type) {
        case "SessionNode":
            node = SessionNode(obj);
            break;
        case "WindowNode":
        case "ActiveWindowNode":
            node = WindowNode(obj);
            break;
        case "TabNode":
        case "ActiveTabNode":
            node = TabNode(obj);
            break;
        case "TextNode":
            node = TextNode(obj);
            break;
        case "SeparatorNode":
            node = SeparatorNode(obj);
            break;
        default:
            throw new Error("Unknown node: " + type);
        }

        return node;
    },

    deserializeTree: function(nodeList) {
        this.$super(nodeList);
        this._addActiveNodes();
    },

    reset: function(rootNode) {
        this.$super(rootNode);
        this._addActiveNodes();
    },

    hasWindow: function(window) {
        return this.hasNode(function(node) {
            if (node instanceof ActiveWindowNode) {
                if (node.getWindow() === window) {
                    return true;
                }
            }
            return false;
        });
    },

    hasTab: function(tab) {
        return this.hasNode(function(node) {
            if (node instanceof ActiveTabNode) {
                if (node.getTab() === tab) {
                    return true;
                }
            }
            return false;
        });
    },

    getNodeForWindow: function(window) {
        if (window.hasOwnProperty(ID_PROPERTY)) {
            let id = window[ID_PROPERTY];
            return this.getNodeById(id);
        }

        // fallback:
        console.warn("The property `" + ID_PROPERTY + "` is not defined within the given window.");
        let windowNode = this.findFirstNode(function(node) {
            if (node instanceof ActiveWindowNode) {
                if (node.getWindow() === window) {
                    return true;
                }
            }
            return false;
        });

        return windowNode;
    },

    getNodeForTab: function(tab) {
        if (tab.hasOwnProperty(ID_PROPERTY)) {
            let id = tab[ID_PROPERTY];
            return this.getNodeById(id);
        }

        // fallback:
        console.warn("The property `" + ID_PROPERTY + "` is not defined within the given tab.");
        let tabNode = this.findFirstNode(function(node) {
            if (node instanceof ActiveTabNode) {
                if (node.getTab() === tab) {
                    return true;
                }
            }
            return false;
        });

        return tabNode;
    },

    getNodeByTabIndex: function(nodeTdx, windowNode) {
        // nodes within different window nodes have to be ignored
        let tabNode = this.findFirstNode(function(currentNode) {
            if (currentNode instanceof ActiveTabNode) {
                return (currentNode.getTabIndex() == nodeTdx);
            }
            return false;
        }, filterNestedWindows(windowNode));

        return tabNode;
    },

    modelPositionToTabIndex: function(node) {
        let nodeTdx = 0;
        let windowNode = getWindowNode(node);
        assert(windowNode, "Invalid containment of tab node.");

        this.traverse(function(currentNode) {
            if (currentNode === node) {
                return Traverse.TERMINATE;
            } else if (currentNode instanceof ActiveTabNode) {
                nodeTdx++;
            }

            return Traverse.CONTINUE;
        }, filterNestedWindows(windowNode));

        return nodeTdx;
    },

    detachChildren: function(groupNode, predicate) {
        assert(groupNode instanceof AbstractGroupNode, "Expected an instance of AbstractGroupNode.");

        if (!groupNode.hasChildren()) {
            return;
        }

        let childNodes = []; // nodes to detach
        this.traverse(function(currentNode) {
            if (currentNode === groupNode) {
                return Traverse.CONTINUE;
            }

            if (predicate(currentNode)) {
                childNodes.push(currentNode);
                return Traverse.SKIP_CHILDREN;
            }

            return Traverse.CONTINUE;
        }, { containerNode: groupNode });

        let currentIndex = groupNode.getIndex();
        for (let i = 0, len = childNodes.length; i < len; ++i) {
            let child = childNodes[i];

            this.moveNode(child.getIndex(), currentIndex, Position.AFTER);
            currentIndex = child.getIndex();
        }
    },

    detachAll: function(groupNode) {
        this.detachChildren(groupNode, function(currentNode) {
            return true;
        });
    },

    _closeWindowNode: function(oldWindowNode) {
        assert(oldWindowNode instanceof ActiveWindowNode, "Wrong type.");

        let newWindowNode = oldWindowNode.toDeactivatedNode();
        oldWindowNode.closeSilently();
        this.replaceNode(oldWindowNode, newWindowNode);

        return newWindowNode;
    },

    _closeTabNode: function(oldTabNode) {
        assert(oldTabNode instanceof ActiveTabNode, "Wrong type.");

        let windowNode = getWindowNode(oldTabNode);
        let tabbrowser = windowNode.getWindow().gBrowser;

        if (tabbrowser.tabs.length == 1) {
            return this._closeWindowNode(windowNode); // delegate
        }

        let newTabNode = oldTabNode.toDeactivatedNode();
        oldTabNode.closeSilently();
        this.replaceNode(oldTabNode, newTabNode);

        return newTabNode;
    },

    closeNode: function(oldNode) {
        if (oldNode instanceof ActiveTabNode) {
            return this._closeTabNode(oldNode);
        } else if (oldNode instanceof ActiveWindowNode) {
            return this._closeWindowNode(oldNode);
        }

        console.warn("Node is not closeable.");
        return oldNode;
    },

    /**
     * @return {array} The direct descendants of the given window node.
     */
    getDescendants: function(windowNode) {
        let descendants = [];

        this.traverse(function(currentNode) {
            if (currentNode === windowNode) {
                return Traverse.CONTINUE;
            }

            descendants.push(currentNode);

            if (currentNode instanceof WindowNode) {
                return Traverse.SKIP_CHILDREN;
            } else {
                return Traverse.CONTINUE;
            }
        }, { containerNode: windowNode });

        return descendants;
    },

    /**
     * @return {array} An array of tab nodes within this branch.
     */
    getTabNodes: function(groupNode) {
        let tabNodes = this.matchNodes(function(currentNode) {
            return (currentNode instanceof TabNode);
        }, filterNestedWindows(groupNode));

        return tabNodes;
    },

    getActiveTabNodes: function(groupNode) {
        let tabNodes = this.matchNodes(function(currentNode) {
            return (currentNode instanceof ActiveTabNode);
        }, filterNestedWindows(groupNode));

        return tabNodes;
    },

    getTabCount: function(groupNode) {
        return this.getTabNodes(groupNode).length;
    },

    getActiveTabCount: function(windowNode) {
        if (windowNode instanceof ActiveWindowNode) {
            return windowNode.getWindow().gBrowser.tabs.length;
        } else {
            return 0;
        }
    },

    getWindowNodes: function(groupNode) {
        let windowNodes = this.matchNodes(function(currentNode) {
            return (currentNode instanceof WindowNode);
        }, { containerNode: groupNode });

        return windowNodes;
    },

    getActiveWindowNodes: function(groupNode) {
        let windowNodes = this.matchNodes(function(currentNode) {
            return (currentNode instanceof ActiveWindowNode);
        }, { containerNode: groupNode });

        return windowNodes;
    },

    moveNode: function(index, referenceIndex, position) {
        let that = this;

        let node = this.getNode(index);
        let sourceNode = node.getParent();

        //[ trivial case no tabs are involved
        if (!(node instanceof TabNode)) {
            // adjust model
            this.$super(index, referenceIndex, position);
            handleEmptyWindow(sourceNode);
            return this;
        }
        //]

        //[ move tab(s)
        let referenceNode = this.getNode(referenceIndex);

        let dstWindowNode;
        if (position == Position.INSIDE) {
            dstWindowNode = getWindowNode(referenceNode);
        } else {
            // for nested window nodes
            dstWindowNode = getWindowNode(referenceNode.getParent());
        }

        //[ close active tab(s) in case of an inactive destination
        let activeTabNodes = this.getActiveTabNodes(node);
        let activeTabCount = activeTabNodes.length;
        if (activeTabCount > 0 && !dstWindowNode.isActive()) {
            activeTabNodes.forEach(function(currentNode) {
                that.closeNode(currentNode);
            });

            node = that.getNode(index); // the new inactive node
            sourceNode = node.getParent();

            activeTabCount = 0;
        }
        //]

        // adjust model
        this.$super(index, referenceIndex, position);

        let srcWindowNode = getWindowNode(sourceNode);
        if (activeTabCount > 0) {
            // update browser state
            moveTabBranch(node, srcWindowNode, dstWindowNode);
        } else {
            // NOTE: this is not necessary in the branch above
            // because observerWindowCloseHandler() will handle empty window nodes
            handleEmptyWindow(srcWindowNode);
        }
        //]

        return this;
    },

    validateModel: function() {
        console.log("Start validation.");

        let windows = windowUtils.windows("navigator:browser");
        let activeWindowNodes = this.getActiveWindowNodes(this.getRootNode());
        if (activeWindowNodes.length != windows.length) {
            console.warn("The count of windows within the model is incorrect!");
        }

        for (let i = 0, len1 = activeWindowNodes.length; i < len1; ++i) {
            let windowNode = activeWindowNodes[i];
            let window     = windowNode.getWindow();
            let tabbrowser = window.gBrowser;

            let expectedTdx = 0;
            let activeTabNodes = this.getActiveTabNodes(windowNode);
            if (activeTabNodes.length != tabbrowser.tabs.length) {
                console.warn("The count of tabs within the model is incorrect!");
            }

            for (let j = 0, len2 = activeTabNodes.length; j < len2; ++j) {
                let currentNode = activeTabNodes[j];

                if (this.getNodeById(currentNode.getId()) !== currentNode) {
                    console.warn("Id map corruption! Node:", currentNode.toString());
                }

                if (expectedTdx != currentNode.getTabIndex()) {
                    console.warn("Invalid index! Node:", currentNode.toString());
                }

                if (currentNode.getTab() !== tabbrowser.tabContainer.childNodes[expectedTdx]) {
                    console.warn("Invalid tab! Node:", currentNode.toString());
                }

                expectedTdx++;
            }

            // remove verified elements
            let index = windows.indexOf(window);
            if (index > -1) {
                windows.splice(index, 1); // remove the element
            } else {
                console.warn("Missing window!");
            }
        }

        // Nodes are missing for these windows
        for (let i = 0, len = windows.length; i < len; ++i) {
            let title = windowUtils.getWindowTitle(window);
            console.warn("Window is not in model! Title:", title);
        }

        console.log("Validation finished.");
    }
});
module.exports.TabModel = TabModel;
