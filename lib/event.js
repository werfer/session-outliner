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

const {
    assert,
    handleException
} = require("utils");

let EventEmitter = Class.$extend({
    __init__: function(sender) {
        if (sender) {
            this._sender = sender;
        } else {
            this._sender = this;
        }
    },

    _handlers: function(event) {
        let events = this._events || (this._events = { });

        if (!events.hasOwnProperty(event)) {
            events[event] = [];
        }

        return events[event];
    },

    emit: function(event) {
        let handlers = this._handlers(event);

        for (let i = 0, len = handlers.length; i < len; ++i) {
            let handler = handlers[i];
            let func = handler.listener;

            //[ prepare
            let params = Array.slice(arguments);
            params[0] = {
                type: event,
                sender: this._sender,
                subject: handler.subject // set subject if it is defined
            };
            //]

            try {
                // call event handler
                func.apply(this, params);
            } catch (e) {
                handleException(e);
            }
        }

        return this;
    },

    on: function(event, listener, subject) {
        if (typeof listener !== "function") {
            throw new TypeError("The listener must be a function.");
        }

        let handlers = this._handlers(event);
        let handler = {
            listener: listener,
            subject: subject
        }

        handlers.push(handler);
        return this;
    },

    once: function(event, listener, subject) {
        let that = this;

        this.on(event, function onceHandler() {
            that.removeListener(event, onceHandler);
            listener.apply(that, arguments);
        }, subject);
        
        return this;
    },

    removeListener: function(event, listener) {
        let handlers = this._handlers(event);
        for (let i = 0, len = handlers.length; i < len; ++i) {
            let handler = handlers[i];

            if (handler.listener === listener) {
                handlers.splice(i, 1);
            }
        }

        return this;
    },

    removeAllListeners: function(event) {
        let handlers = this._handlers(event);
        handlers.length = 0;

        return this;
    }
});
module.exports.EventEmitter = EventEmitter;
