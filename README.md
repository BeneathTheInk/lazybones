# Lazybones

Lazybones is a modified Backbone collection that integrates with PouchDB. By combining Backbone's object-oriented approach with PouchDB's super flexible databases, Lazybones provides a highly-functional API for storing and manipulating data in the browser and Node.js.

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

Lazybones is a modified Backbone collection with a custom sync function that allows for fetching and writing to a Pouch database. To begin using Lazybones, you only need the name of the database you are using:

```javascript
var db = new Lazybones("mydb");
```

This will return an empty backbone collection attached to a newly initiated PouchDB instance. This instance if available via `db.pouch` although you should rarely need access to it.

At this point you can load in documents from the database into memory. The easiest way to do this is via a normal fetch:

```javascript
db.fetch().then(function() {
   // collection now contains everything in PouchDB
});
```

Using fetch, you can also retrieve specific subsets of documents, for example only those in a specific CouchDB view. Just add `filter: "myview"` to fetch options. All the other standard Backbone sync options are available too.

Lazybones also provides a method for continuously listening to changes in the database and replicating them to the in-memory documents:

```javascript
db.connect();

// later
db.disconnect();
```

When `.connect()` is called, the database will listen to the database changes feed and automatically push changes to documents in the collection. This means that `connect`, in a lot of ways, is like fetch with the exception that it continually updates the documents.

## Documentation

For quick documentation, please see the inline comments in the source code. These comments are written in markdown, so you can also build them for a prettier experience.

```bash
npm run build-docs
```

## How to Build from Scratch

Lazybones uses Grunt to build a Browserify bundle from the original source found in `lib/`. When the command below completes, the compiled source will be saved to `dist/` directory.

```bash
npm install && grunt
```

If you don't the Grunt cli tools installed globally, run `npm install -g grunt-cli` before running that command.

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