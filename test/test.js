var Lazybones = require("../"),
	Backbone = require("backbone"),
	PouchDB = require("pouchdb"),
	expect = require("chai").expect;

PouchDB.plugin(Lazybones());

describe("CRUD", function() {
	var col, pouch;

	this.slow(1000);
	this.timeout(5000);

	beforeEach(function() {
		pouch = new PouchDB("testdb");
		var sync = pouch.lazybones();
		col = new Backbone.Collection(null);
		col.model = Backbone.Model.extend({ sync: sync });
		col.sync = sync;
	});

	afterEach(function(done) {
		pouch.destroy(done);
	});

	it("creates a document", function(done) {
		var model = col.add({ foo: "bar" });

		model.save().then(function(res) {
			expect(this).to.equal(model);
			expect(res.ok).to.be.ok;
			return pouch.get(model.id);
		})

		.then(function(doc) {
			expect(doc).to.deep.equal(model.toJSON());
			done();
		})

		.catch(done);
	});

	it("deletes a document", function(done) {
		var model = col.add({ foo: "bar" });

		model.save().then(function() {
			return model.destroy();
		})

		.then(function(res) {
			expect(res.ok).to.be.ok;
			expect(col.contains(model)).to.not.be.ok;
			return pouch.get(model.id).then(function() {
				throw new Error("Document was not deleted from database.");
			}, function(e) {
				expect(e.status).to.equal(404);
				done();
			});
		})

		.catch(done);
	});

	it("updates a document", function(done) {
		var model = col.add({ foo: "bar" });

		model.save().then(function() {
			return model.set({ foo: true, bam: "baz" }).save();
		})

		.then(function(res) {
			expect(res.ok).to.be.ok;
			return pouch.get(model.id);
		})

		.then(function(doc) {
			expect(doc).to.deep.equal(model.toJSON());
			done();
		})

		.catch(done);
	});

	it("reads a database", function(done) {
		pouch.bulkDocs([
			{ _id: "a" },
			{ _id: "b" },
			{ _id: "c" }
		]).then(function() {
			return col.fetch();
		})

		.then(function() {
			expect(col.length).to.equal(3);
			expect(col.pluck("_id").sort()).to.deep.equal([ "a", "b", "c" ]);
			done();
		})

		.catch(done);
	});

	it("reads a document", function(done) {
		var model = col.add({ foo: "bar" }),
			docid = model.id;

		model.save().then(function(res) {
			return pouch.put({
				_id: docid,
				_rev: res.rev,
				foo: "baz"
			});
		}).then(function() {
			return model.fetch();
		})

		.then(function() {
			expect(model.get("foo")).to.equal("baz");
			expect(model.get("_rev").substr(0, 1)).to.equal("2");
			done();
		})

		.catch(done);
	});

});

describe("Live Sync", function() {

});

describe("Conflicts", function() {

});
