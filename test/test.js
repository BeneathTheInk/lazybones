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
		col.model = Backbone.Model.extend({ sync: sync, idAttribute: "_id" });
		col.sync = sync;
	});

	afterEach(function(done) {
		pouch.destroy(done);
	});

	it("creates a model", function(done) {
		var model = col.add({ foo: "bar" });

		model.save().then(function(res) {
			expect(res.ok).to.be.ok;
			return pouch.get(model.id);
		})

		.then(function(doc) {
			expect(doc).to.deep.equal(model.toJSON());
			done();
		})

		.catch(done);
	});

	it("deletes a model", function(done) {
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

	it("updates a model", function(done) {
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

	it("reads a collection", function(done) {
		pouch.bulkDocs([
			{ _id: "a" },
			{ _id: "b" },
			{ _id: "c" }
		]).then(function(res) {
			expect(res.length).to.equal(3);
			expect(res[0].ok).to.be.ok;
			expect(res[1].ok).to.be.ok;
			expect(res[2].ok).to.be.ok;
			return col.fetch();
		})

		.then(function() {
			expect(col.length).to.equal(3);
			expect(col.pluck("_id").sort()).to.deep.equal([ "a", "b", "c" ]);
			done();
		})

		.catch(done);
	});

	it("reads a model", function(done) {
		var model = col.add({ _id: "testmodel" });

		return pouch.put({
			_id: "testmodel",
			foo: "bar"
		}).then(function(res) {
			expect(res.ok).to.be.ok;
			return model.fetch();
		})

		.then(function() {
			expect(model.get("foo")).to.equal("bar");
			expect(model.get("_rev").substr(0, 1)).to.equal("1");
			done();
		})

		.catch(done);
	});

});

describe("Changes Feed", function() {
	var col, pouch;

	this.slow(1000);
	this.timeout(5000);

	beforeEach(function() {
		pouch = new PouchDB("testdb");
		var sync = pouch.lazybones();
		col = new Backbone.Collection(null);
		col.model = Backbone.Model.extend({ sync: sync, idAttribute: "_id" });
		col.sync = sync;
	});

	afterEach(function(done) {
		pouch.destroy(done);
	});

	it("adds model from changes", function(done) {
		pouch.post({ foo: "bar" })

		.then(function(res) {
			expect(res.ok).to.be.ok;
			return col.fetch({ changes: true });
		})

		.then(function() {
			expect(col.length).to.equal(1);
			var model = col.first();
			expect(model.isNew()).to.not.be.ok;
			expect(model.get("foo")).to.equal("bar");
			done();
		})

		.catch(done);
	});

	it("updates model from changes", function(done) {
		// add doc
		pouch.post({ foo: "bar" })

		// base collection fetch
		.then(function(res) {
			return col.fetch()

			// update the model
			.then(function() {
				expect(col.length).to.equal(1);
				return pouch.put({ _id: res.id, _rev: res.rev, foo: "baz" });
			});
		})

		// fetch from changes feed
		.then(function(res) {
			expect(res.ok).to.be.ok;
			return col.fetch({ changes: true });
		})

		.then(function() {
			expect(col.length).to.equal(1);
			var model = col.first();
			expect(model.isNew()).to.not.be.ok;
			expect(model.get("foo")).to.equal("baz");
			done();
		})

		.catch(done);
	});

	it("removes model from changes", function(done) {
		// add doc
		pouch.post({ foo: "bar" })

		// base collection fetch
		.then(function(res) {
			return col.fetch()

			// remove the model
			.then(function() {
				expect(col.length).to.equal(1);
				return pouch.remove(res.id, res.rev);
			});
		})

		// fetch again from changes feed
		.then(function(res) {
			expect(res.ok).to.be.ok;
			return col.fetch({ changes: true });
		})

		.then(function() {
			expect(col.length).to.equal(0);
			done();
		})

		.catch(done);
	});

	it("listens for live changes", function(done) {
		col.fetch({ changes: { live: true } });
		expect(col.length).to.equal(0);

		col.on("add", function(model) {
			expect(col.length).to.equal(1);
			expect(model.isNew()).to.not.be.ok;
			expect(model.get("foo")).to.equal("bar");
			done();
		});

		// add doc
		pouch.post({ foo: "bar" }).catch(done);
	});

});
