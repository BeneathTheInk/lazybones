# Lazybones

A custom Backbone sync method for PouchDB, with support for views and changes. This is very similar to [backbone-pouch](https://github.com/jo/backbone-pouch) but is slightly more dynamic and up-to-date for the latest PouchDB API.

## Install

Download the latest version from our [release page](https://github.com/BeneathTheInk/lazybones/releases) and use via a script tag. The variable `Lazybones` will be attached to `window`.

```html
<script type="text/javascript" src="lazybones.js"></script>
```

If using Browserify or Node.js, you can install via NPM and use via `require("lazybones")`.

```shell
$ npm install lazybones
```

## Basic Usage

### Method 1: PouchDB Plugin

If you want to generate a sync function with the Pouch database already attached, use the built in plugin interface. `db.lazybones()` will produce a sync function that uses `db` to fetch data.

```js
PouchDB.plugin(Lazybones({
    // global options
}));

// later
var db = new PouchDB("mydb");
Backbone.Model.extend({
    sync: db.lazybones()
});
```

### Method 2: Generic sync

The simplest method is to use the raw sync method directly. You will need to reference the Pouch database through the model.

```js
var db = new PouchDB("mydb");
Backbone.Model.extend({
    sync: Lazybones.sync,
    pouchdb: db,
    syncOptions: {
        // options specific to this model
    }
});
```

## Documentation

We have [pretty HTML docs](http://beneaththeink.github.io/lazybones/lazybones.html) with inline source code hosted on Github Pages. This documentation is generated from block-level comments in the code using [Doxxo](https://github.com/BeneathTheInk/doxxo), so you can also build them locally.

```bash
npm run build-docs
```

## How to Build from Scratch

Lazybones uses Grunt to build a Browserify bundle from the original source found in `lib/`. When the command below completes, the compiled source will be saved to `dist/` directory.

```bash
npm install && npm run build-js
```

## Running the Unit Tests

Lazybones has several unit tests written for Node.js and the browser. Before running tests, install all test dependencies:

```
npm install
```

To get tests running on Node.js, run:

```
npm test
```

To run tests in the browser, start a test server with this command. When the server is running, navigate your browser to <http://localhost:8000>.

```
npm run dev
```
