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

## API

Lazybones has a unique API, however most it is inherited from Backbone. Please read the [Backbone documentation](http://backbonejs.org/) for more information on methods and concepts.

### `new LazyBones( name [, options ] )`

The Lazybones database constructor. This returns an instance of Lazybones, which is a subclass of `Backbone.Collection`.

The name should be a string used to connect to a Pouch database. This can either be a local database name (indexeddb or leveldb) or a remote CouchDB url. This argument is required.

`options` are passed directly to the `Backbone.Collection` constructor, except for one parameter:

- `pouch` *optional* - An instance of PouchDB or an object of options to pass to the PouchDB constructor.

### `db.connect( [ options ] )`

Listens to the changes feed in the PouchDB and sets all changes to the in-memory documents. This allows the models to respond to changes in the database as the happen. `options` is an optional argument that is passed to `pouch.changes()`.

### `db.disconnect( )`

Disconnects the database from the changes feeds or does nothing if not currently connected.

### `db.destroy( )`

Destroys the Pouch database, ensuring any queued writes are properly canceled.

### `new Lazybones.Document( [ attrs ][, options ] )`

This is the `Backbone.Model` subclass used to represent all documents in the database. This model has an identical API to `Backbone.Model`.