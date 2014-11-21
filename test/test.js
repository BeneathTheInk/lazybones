var Lazybones = require("../"),
	expect = require("chai").expect;

describe("Lazybones", function() {
	
	it("creates document model with an id", function() {
		var doc = new Lazybones.Document({ foo: "bar" });
		expect(doc.id).to.be.ok;
		expect(doc.get("foo")).to.equal("bar");
	});

	it("creates a database", function() {
		var db = new Lazybones("testdb");
		expect(db.id).to.equal("testdb");
	});

});