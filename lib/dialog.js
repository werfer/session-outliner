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
// Sidebar-Worker with "injectInDocument" support
const { Worker } = require('sdk/deprecated/sync-worker');

const { open: openWindow } = require('sdk/window/helpers');
const events = require("sdk/system/events");

const { EventEmitter } = require("event");

const Dialog = EventEmitter.$extend({
    __classvars__: {
        URL: "chrome://outliner/content/dialog.xul"
    },

    __init__: function(contentUrl, config) {
        this._config = config || { };
/*
        this._contentScriptFile = null;
        if ("contentScriptFile" in config) {
            this._contentScriptFile = config.contentScriptFile;
            delete config.contentScriptFile;
        }
*/
        this._contentUrl = contentUrl;
        this._window = null;
        this._worker = null;
    },

    show: function() {
        if (this._window) {
            return; // nothing to do
        }

        let that = this;
        let features = this._config.features || { };
        features["chrome"] = true;
  
        openWindow(this.$class.URL, {
            features: features
        }).then(function success(window) {
            //[ create and initialize worker
            let contentPanel = window.document.getElementById("content-panel");
            contentPanel.addEventListener('DOMWindowCreated', function onCreated() {
                // create communication port
                let worker = Worker({
                    window: contentPanel.contentWindow,
                    injectInDocument: true
                });

                // inner window:
                contentPanel.contentWindow.addEventListener('DOMContentLoaded', function onPaneReady() {
                    contentPanel.contentWindow.removeEventListener('DOMContentLoaded', onPaneReady, false);
/*
                    // create communication port
                    let worker = Worker({
                        window: contentPanel.contentWindow,
                        contentScriptFile: that._contentScriptFile
                    });
*/
                    that._worker = worker;
                    that.emit("attach", worker);
                }, false);
            }, true);
            contentPanel.setAttribute("src", that._contentUrl);
            //]

            if (that._config.title) {
                window.document.title = that._config.title;
            }

            that._window = window;
            that.emit("show");
        });

        events.on("domwindowclosed", function onClose( { subject } ) {
            if (subject == that._window) {
                events.off("domwindowclosed", onClose);
                console.log("got 'domwindowclosed' event");
                that._window = null;

                that.emit("detach", that._worker);
                that._worker = null;
            }
        }, true);
    },

    close: function() {
        if (this._window) {
            return; // nothing to do
        }

        this._window.close();
        this.emit("close");
    },

    getWindow: function() {
        return this._window;
    },

    getWorker: function() {
        return this._worker;
    }
});
module.exports.Dialog = Dialog;
