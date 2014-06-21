Session Outliner
================

_Session Outliner_ is a Firefox Add-on which aims to implement most of the features provided by
[TabsOutliner™](https://chrome.google.com/webstore/detail/tabs-outliner/eggkanocgddhmamlbiijnphhppkpkmkl) for Chrome.
The Add-on is built on top of the [jetpack/Add-on SDK](https://ftp.mozilla.org/pub/mozilla.org/labs/jetpack/jetpack-sdk-latest.zip).


Status
======
Most of the features offered by TabsOutliner™ are already implement,
however, due to a lack of testing this Add-on has not to be considered as stable.


Design
======
The complete browsing session is stored within an IndexedDB database.
Every change on the internal model is immediately commited to the database.
Like [TabsOutliner™] _Session Outliner_ is able to operate with multiple views.
This is achieved by the event driven communication through
[content workers](https://developer.mozilla.org/en-US/Add-ons/SDK/Low-Level_APIs/content_worker)
between the backend and the content scripts of the frontend.


TODO
====
Probably the most important task to deal with is the improvement of the frontend's apperance.
Other notable things to implement:
 * completion of the text-node and separator-node support
 * detect opener tab (unlike Chrome Firefox has no _openerTabId_ property)


Libraries
=========
The following libraries were used to develope _Session Outliner_:
 * [classy](https://github.com/mitsuhiko/classy)
 * [jqTree](http://mbraak.github.io/jqTree/)
