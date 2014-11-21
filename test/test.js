var Lazybones = require("../"),
	expect = require("chai").expect;

describe("Document", function() {
	
	it("creates document model with an id", function() {
		var doc = new Lazybones.Document({ foo: "bar" });
		expect(doc.id).to.be.ok;
		expect(doc.get("foo")).to.equal("bar");
	});

});

describe("Database", function() {

	it("creates a database and inserts metadata", function(done) {
		var db = new Lazybones("testdb");
		expect(db.id).to.equal("testdb");
		expect(db.isNew()).to.equal(true);

		db.save().then(function() {
			expect(db.get("_rev")).to.be.ok;
			expect(db.isNew()).to.equal(false);
			done();
		}).catch(done);
	});

});