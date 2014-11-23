require("bluebird").longStackTraces();

var Lazybones = require("../"),
	chai = require("chai"),
	expect = chai.expect;

chai.Assertion.addProperty('LazyError', function() {
	this.instanceof(Lazybones.utils.LazyError);
});

chai.Assertion.addMethod('errorcode', function(expected_code) {
	this.assert(
		this._obj.code === expected_code,
		"expected error code '" + expected_code + "' but recieved '" + this._obj.code + "' instead",
		"expected error code to not be '" + expected_code + "'"
	);
});

describe("Basics", function() {
	
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

	it("creates a database instance", function() {
		var db = new Lazybones("testdb");
		expect(db.id).to.equal("testdb");
		expect(db.isNew()).to.equal(true);
		expect(db).to.be.instanceof(Lazybones.Document);
	});

	it("throws error if database is missing an ID", function() {
		var threw = false;

		try {
			new Lazybones();
		} catch(e) {
			expect(e).to.be.LazyError.with.errorcode("MISSING_ID");
			threw = true;
		}

		expect(threw).to.equal(true, "threw an error");
	});

});

describe("Sync", function() {
	var db;

	this.slow(5000);
	this.timeout(20000);

	beforeEach(function() {
		db = new Lazybones("testdb");
	});

	afterEach(function(done) {
		db.destroy().then(function() { done(); }, done);
	});

	it("inserts metadata document if it doesn't exist", function(done) {
		expect(db.isNew()).to.equal(true);
		
		db.save().then(function() {
			expect(db.isNew()).to.equal(false);
			done();
		}).catch(done);
	});

	it("destroys empty database", function() {
		// db.destory().then(function() { done(); }, done);
	});
});

describe("Conflicts", function() {

});