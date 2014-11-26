require("bluebird").longStackTraces();

var Lazybones = require("../"),
	expect = require("chai").expect;

describe("Documents", function() {
	
	it("creates document model with a new id", function() {
		var doc = new Lazybones.Document({ foo: "bar" });
		expect(doc.id).to.be.ok;
		expect(doc.get("foo")).to.equal("bar");
	});

	it("documents without a revision id are considered new", function() {
		var doc = new Lazybones.Document();
		expect(doc.isNew()).to.be.ok;
	});

	it("documents with a revision id are not considered new", function() {
		var doc = new Lazybones.Document({ _rev: "1" });
		expect(doc.isNew()).to.not.be.ok;
	});

});

describe("Database", function() {

	it("creates a database instance", function() {
		var db = new Lazybones("testdb");
		expect(db.name).to.equal("testdb");
	});

	it("throws error if database is missing an ID", function() {
		expect(function() {
			new Lazybones();
		}).to.throw(Lazybones.utils.LazyError, /MISSING_ID/);
	});

	it("destroys a database", function(done) {
		var db = new Lazybones("testdb");
		db.destroy().then(function() { done(); }, done);
	});

});

describe("CRUD", function() {
	var db;

	this.slow(3000);
	this.timeout(20000);

	beforeEach(function() {
		db = new Lazybones("testdb");
	});

	afterEach(function(done) {
		db.destroy().then(function() { done(); }, done);
	});

	it("creates a document", function(done) {
		var model = db.add({ foo: "bar" });

		model.save().then(function(res) {
			expect(this).to.equal(model);
			expect(res.ok).to.be.ok;
			return db.pouch.get(model.id);
		})

		.then(function(doc) {
			expect(doc).to.deep.equal(model.toJSON());
			done();
		})

		.catch(done);
	});

	it("deletes a document", function(done) {
		var model = db.add({ foo: "bar" });

		model.save().then(function() {
			return model.destroy();
		})

		.then(function(res) {
			expect(res.ok).to.be.ok;
			expect(db.contains(model)).to.not.be.ok;
			return db.pouch.get(model.id).then(function() {
				throw new Error("Document was not deleted from database.");
			}, function(e) {
				expect(e.status).to.equal(404);
				done();
			});
		})

		.catch(done);
	});

	it("updates a document", function(done) {
		var model = db.add({ foo: "bar" });

		model.save().then(function() {
			return model.set({ foo: true, bam: "baz" }).save();
		})

		.then(function(res) {
			expect(res.ok).to.be.ok;
			return db.pouch.get(model.id);
		})

		.then(function(doc) {
			expect(doc).to.deep.equal(model.toJSON());
			done();
		})

		.catch(done);
	});

	it("reads a database", function(done) {
		db.pouch.bulkDocs([
			{ _id: "a" },
			{ _id: "b" },
			{ _id: "c" }
		]).then(function() {
			return db.fetch();
		})

		.then(function() {
			expect(db.length).to.equal(3);
			expect(db.pluck("_id").sort()).to.deep.equal([ "a", "b", "c" ]);
			done();
		})

		.catch(done);
	});

	it("reads a document", function(done) {
		var model = db.add({ foo: "bar" }),
			docid = model.id;

		model.save().then(function(res) {
			return db.pouch.put({
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