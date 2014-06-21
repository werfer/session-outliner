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
    Cc, Ci, components
} = require("chrome");

const { promise } = require("sdk/window/helpers");

const tabUtils = require("sdk/tabs/utils");
const urls = require("sdk/url");

const URI_BROWSER = "chrome://browser/content/browser.xul",
      NAME = "_blank",
      FEATURES = "chrome,all,dialog=no,non-private";

function openBrowserWindow(url) {
    let ww = Cc["@mozilla.org/embedcomp/window-watcher;1"].
             getService(Ci.nsIWindowWatcher);

    let urlArg = Cc["@mozilla.org/supports-string;1"].
                 createInstance(Ci.nsISupportsString);
    urlArg.data = url;

    let window = ww.openWindow(null, URI_BROWSER, NAME, FEATURES, urlArg);
    return window;
}

function openBrowser(url) {
    return promise(openBrowserWindow.apply(null, arguments), "load");
}
module.exports.openBrowser = openBrowser;

function setTabStateFromNode(tab, node) {
    let gSessionStore = Cc["@mozilla.org/browser/sessionstore;1"].
                        getService(Ci.nsISessionStore);

    gSessionStore.setTabState(tab, JSON.stringify({
        entries: [{
            url: node.getUrl(),
            title: node.getTitle()
        }]
    }));
}
module.exports.setTabStateFromNode = setTabStateFromNode;

// TODO remove
function adoptTabState(sourceTab, targetTab) {
    let gSessionStore = Cc["@mozilla.org/browser/sessionstore;1"].
                        getService(Ci.nsISessionStore);

    let state = gSessionStore.getTabState(sourceTab);
    gSessionStore.setTabState(targetTab, state);
}
module.exports.adoptTabState = adoptTabState;

function defaultTitle(url) {
    let urlObj = new urls.URL(url)
    let title = urlObj.hostname;
    if (urlObj.pathname.length > 1) {
        title += urlObj.pathname;
    }

    return title;
}
module.exports.defaultTitle = defaultTitle;
