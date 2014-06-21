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
const self = require("sdk/self")
const { setTimeout } = require("sdk/timers");
const { Sidebar } = require("sdk/ui/sidebar");
const { ActionButton } = require('sdk/ui/button/action');

const { outliner } = require("outliner");
const { Dialog } = require("dialog");

// ****************************************************************************
// user interface:

let outlinerDialog = Dialog(self.data.url("panel.html"), {
    title: "Session Outliner",
    features: {
        left: 0,
        top: 0,
        width: 350,
        height: 700
    }
});

outlinerDialog.on("attach", function(event, worker) {
    console.log("attaching dialog worker");
    outliner.addWorker(worker);
});

outlinerDialog.on("detach", function(event, worker) {
    console.log("detaching dialog worker");
    outliner.removeWorker(worker);
});

outlinerDialog.on("show", function(event) {
    setTimeout(moveDialog, 100);
});

function moveDialog() {
    let window = outlinerDialog.getWindow();
    window.moveTo(0, 0);
}

let outlinerSidebar = Sidebar({
    id: "outliner-sidebar",
    title: "Session Outliner",
    url: self.data.url("panel.html"),
    onAttach: function(worker) {
        console.log("attaching sidebar worker");
        outliner.addWorker(worker);
    },
    onDetach: function(worker) {
        console.log("detaching sidebar worker");
        outliner.removeWorker(worker);
    }
});

let button = ActionButton({
    id: "outliner-link",
    label: "Session Outliner",
    icon: self.data.url("images/icon.svg"),
    onClick: function() {
        outlinerDialog.show();
    }
});


// ****************************************************************************
// entry point:

outliner.init();
