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
const { Cc, Ci, components } = require("chrome");
const windowUtils = require('sdk/window/utils');
const tabUtils = require('sdk/tabs/utils');

const { EventEmitter } = require("event");

// ****************************************************************************
// InstallHook:

let InstallHook = function(owner, orgFunc, hookFunc) {
    let _owner = owner;
    let _orgFunc = orgFunc;
    let _hookFunc = hookFunc;
    let _isOwnPropertyDescriptor;

    let _replacement = function() {
        _hookFunc.apply(_owner, arguments);
        _orgFunc.apply(_owner, arguments);
    };

    _isOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(_owner, _orgFunc.name);
    if (_isOwnPropertyDescriptor) {
        _owner[_orgFunc.name] = _replacement;
    } else {
        Object.defineProperty(_owner, _orgFunc.name, {
            writable: true,
            configurable: true,
            value: _replacement
        });
    }

    let _restore = function() {
        if (_isOwnPropertyDescriptor) {
            _owner[_orgFunc.name] = _orgFunc;
        } else {
            // the property belongs to us
            delete _owner[_orgFunc.name];
        }

        _owner = null;
        _orgFunc = null;
        _hookFunc = null;
    }

    return {
        restore: _restore,
        owner: _owner
    }
};

// ****************************************************************************
// browserObserver implementation:

const TabStateNotification = {
    LOAD:     1,
    STOP:     2,
    LOCATION: 4,
    PINNED:   8,
    UNPINNED: 16
};
module.exports.TabStateNotification = TabStateNotification;

/**
 * Events:
 * tabOpen
 * tabClose
 * tabMove
 * tabStateChanged
 * tabRestoring
 * tabRestored
 * swapTabs
 * windowOpen
 * windowClose
 */
const browserObserver = (function() {
    let hooks = [];
    let port = EventEmitter();

    let system = require("sdk/system/events");
    let tabs = require('sdk/tabs');
    let tabsObserver = require("sdk/tabs/observer").observer;

    let wm = Cc['@mozilla.org/appshell/window-mediator;1'].getService(Ci.nsIWindowMediator);

    const STATE_START = Ci.nsIWebProgressListener.STATE_START;
    const STATE_STOP  = Ci.nsIWebProgressListener.STATE_STOP;
    const STATE_IS_REQUEST = Ci.nsIWebProgressListener.STATE_IS_REQUEST;
    const STATE_IS_WINDOW  = Ci.nsIWebProgressListener.STATE_IS_WINDOW;
    const LOCATION_CHANGE_SAME_DOCUMENT = Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT;

    let windowListener = {
        onOpenWindow: function(xulWindow) {
            // wait for the window to finish loading
            let domWindow = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor).
                                      getInterface(Ci.nsIDOMWindow);

            domWindow.addEventListener("load", function onLoad() {
                // remove the load event listener
                domWindow.removeEventListener("load", onLoad, false);

                if (!windowUtils.isBrowser(domWindow) || windowUtils.isWindowPrivate(domWindow)) {
                    return;
                }

                attachListener([domWindow]);
                onWindowOpen(domWindow);
            }, false);
        },

        onCloseWindow: function(xulWindow) {
            let domWindow = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor).
                                      getInterface(Ci.nsIDOMWindow);

            if (!windowUtils.isBrowser(domWindow) || windowUtils.isWindowPrivate(domWindow)) {
                return;
            }

            detachListener([domWindow]);
            onWindowClose(domWindow);
        },

        onWindowTitleChange: function(xulWindow, title) {}
    };

    let progressListener = {
        onStateChange: function(browser, webProgress, request, flags, status) {
            if (!webProgress.isTopLevel || !flags) {
                return;
            }

            if (!(flags & (STATE_IS_WINDOW | STATE_IS_REQUEST))) {
                return;
            }

            if (flags & STATE_START) {
                let tab = tabUtils.getTabForContentWindow(webProgress.DOMWindow);
                onTabStateChanged(tab, TabStateNotification.LOAD);
            } else if (flags & STATE_STOP) {
                let tab = tabUtils.getTabForContentWindow(webProgress.DOMWindow);
                onTabStateChanged(tab, TabStateNotification.STOP);
            }
        },

        onLocationChange: function(browser, webProgress, request, location, flags) {
            if (flags & LOCATION_CHANGE_SAME_DOCUMENT) {
                return;
            }

            let tab = tabUtils.getTabForContentWindow(webProgress.DOMWindow);
            onTabStateChanged(tab, TabStateNotification.LOCATION);
        },

        onProgressChange:    function() {},
        onSecurityChange:    function() {},
        onStatusChange:      function() {},
        onRefreshAttempted:  function() {},
        onLinkIconAvailable: function() {}
    };

    let hook_swapBrowsersAndCloseOther = function(aOurTab, aOtherTab) {
        queueEvent({
            type: "swapTabs",
            arguments: [aOurTab, aOtherTab]
        });
    };

    let hook_pinTab = function(aTab) {
        queueEvent({
            type: "aboutToPin",
            arguments: [aTab]
        });
    };

    let hook_unpinTab = function(aTab) {
        queueEvent({
            type: "aboutToUnpin",
            arguments: [aTab]
        });
    };

    let hook_openLinkIn = function(url, where, params) {
        let selectedTab = this.gBrowser.selectedTab;
        queueEvent({
            type: "openLinkIn",
            arguments: [selectedTab, url, where, params]
        });
    };

    let attachListener = function(windows) {
        for (let i = 0, len = windows.length; i < len; ++i) {
            let window = windows[i];
            let tabbrowser = window.gBrowser;

            let document = tabbrowser.ownerDocument;
            document.addEventListener('SSTabRestoring', onTabRestoring, false);
            document.addEventListener('SSTabRestored', onTabRestored, false);

            tabbrowser.addTabsProgressListener(progressListener);

            //[ install hooks
            hooks.push(
                InstallHook(window,
                            window.openLinkIn,
                            hook_openLinkIn)
                      );

            hooks.push(
                InstallHook(tabbrowser,
                            tabbrowser.swapBrowsersAndCloseOther,
                            hook_swapBrowsersAndCloseOther)
                      );

            hooks.push(
                InstallHook(tabbrowser,
                            tabbrowser.pinTab,
                            hook_pinTab)
                      );

            hooks.push(
                InstallHook(tabbrowser,
                            tabbrowser.unpinTab,
                            hook_unpinTab)
                      );
            //]
        }
    };

    let detachListener = function(windows) {
        for (let i = 0, windowLen = windows.length; i < windowLen; ++i) {
            let window = windows[i];
            let tabbrowser = window.gBrowser;

            let document = tabbrowser.ownerDocument;
            document.removeEventListener('SSTabRestoring', onTabRestoring, false);
            document.removeEventListener('SSTabRestored', onTabRestored, false);

            tabbrowser.removeTabsProgressListener(progressListener);

            //[ remove hooks
            // NOTE: itererate in reverse in order to avoid re-indexing issues
            let len = hooks.length;
            while (len--) {
                let hook = hooks[len];
                if (hook.owner === window || hook.owner === tabbrowser) {
                    hook.restore();
                    hooks.splice(len, 1);
                }
            }
            //]
        }
    };

    let onWindowOpen = function(domWindow) {
        queueEvent({
            type: "windowOpen",
            arguments: [domWindow]
        });
    };

    let onWindowClose = function(domWindow) {
        queueEvent({
            type: "windowClose",
            arguments: [domWindow]
        });
    };

    let onTabOpen = function(tab, event) {
        queueEvent({
            type: "tabOpen",
            arguments: [tab]
        });
    };

    let onTabClose = function(tab, event) {
        // NOTE event.detail values:
        // "0" tab and browser are about to be closed
        // "1" the tab will be closed, the docshells are going to be exchanged
        queueEvent({
            type: "tabClose",
            arguments: [tab, event.detail]
        });
    };

    let onTabSelect = function(tab, event) {
        queueEvent({
            type: "tabSelect",
            arguments: [tab]
        });
    };

    let onTabMove = function(tab, event) {
        queueEvent({
            type: "tabMove",
            arguments: [tab, event.detail, tab._tPos]
        });
    };

    let onTabPinned = function(tab) {
        onTabStateChanged(tab, TabStateNotification.PINNED);
    };

    let onTabUnpinned = function(tab) {
        onTabStateChanged(tab, TabStateNotification.UNPINNED);
    };

    let onTabStateChanged = function(tab, state) {
        queueEvent({
            type: "tabStateChanged",
            arguments: [tab, state]
        });
    };

    let onTabRestoring = function(event) {
        console.log("onTabRestoring()");
        queueEvent({
            type: "tabRestoring",
            arguments: [event.target]
        });
    };

    let onTabRestored = function(event) {
        console.log("onTabRestored()");
        queueEvent({
            type: "tabRestored",
            arguments: [event.target]
        });
    };

    let connect = function() {
        //[ tab group
        tabsObserver.on("open", onTabOpen); // xul tab
        tabsObserver.on("close", onTabClose);
        tabsObserver.on("select", onTabSelect);
        tabsObserver.on("move", onTabMove);
        tabsObserver.on("pinned", onTabPinned);
        tabsObserver.on("unpinned", onTabUnpinned);
        //]

        wm.addListener(windowListener);
        attachListener(windowUtils.windows("navigator:browser"));
    };

    let disconnect = function() {
        //[ tab group
        tabsObserver.removeListener("open", onTabOpen);
        tabsObserver.removeListener("close", onTabClose);
        tabsObserver.removeListener("select", onTabSelect);
        tabsObserver.removeListener("move", onTabMove);
        tabsObserver.removeListener("pinned", onTabPinned);
        tabsObserver.removeListener("unpinned", onTabUnpinned);
        //]

        wm.removeListener(windowListener);
        detachListener(windowUtils.windows("navigator:browser"));

        eventQueue.length = 0;
    };

    //[ event filter
    let eventQueue = [];
    let eventFilters = [];
    let processEvents = true;

    let queueEvent = function(event) {
        for (let i = 0, len = eventFilters.length; i < len; ++i) {
            let entry = eventFilters[i];

            // keep all the events for which filter() returns a true value
            if (entry.filter(event, i, eventFilters)) {
                continue;
            }

            if (entry.once) {
                // remove filter
                eventFilters.splice(i, 1);
            }

            return;
        }

        if (processEvents) {
            let args = event.arguments;
            args.unshift(event.type);
            port.emit.apply(port, args);
        } else {
            eventQueue.push(event);
        }
    };
    
    /**
     * predicate signature: val, i, t
     */
    let installEventFilter = function(filter, once) {
        eventFilters.push({
            filter: filter,
            once: once
        });
    };

    let removeEventFilter = function(filter) {
        for (let i = 0, len = eventFilters.length; i < len; ++i) {
            let entry = eventFilters[i];
            
            if (entry.filter === filter) {
                // remove filter
                eventFilters.splice(i, 1);
            }
        }
    };

    let stopProcessing = function() {
        processEvents = false;
    };

    let resumeProcessing = function() {
        for (let i = 0, len = eventQueue.length; i < len; ++i) {
            let entry = eventQueue[i];
            let args = entry.arguments;
            args.unshift(entry.type);
            port.emit.apply(port, args);
        }

        // reset
        eventQueue.length = 0;
        processEvents = true;
    };

    /**
     * predicate signature: val, i, t
     */
    let filterPendingEvents = function(predicate) {
        eventQueue = eventQueue.filter(predicate);
    };
    //]

    return {
        connect: connect,
        disconnect: disconnect,
        stopProcessing: stopProcessing,
        resumeProcessing: resumeProcessing,
        installEventFilter: installEventFilter,
        removeEventFilter: removeEventFilter,
        filterPendingEvents: filterPendingEvents,
        port: port
    }
})();
module.exports.browserObserver = browserObserver;
