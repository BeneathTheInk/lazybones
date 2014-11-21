var http = require("http"),
	fs = require("fs"),
	path = require("path");

function resolve(p) {
	return path.resolve(__dirname, "../..", p);
}

var mimes = {
	".js": "application/javascript",
	".css": "text/css",
	".html": "text/html"
}

var server = http.createServer(function(req, res) {
	res.statusCode = 200;

	console.log("%s %s", req.method, req.url);

	var fpath = resolve("." + req.url),
		stat, mime;

	fs.stat(fpath, function(err, stat) {
		if (stat && stat.isFile()) {
			mime = mimes[path.extname(fpath)];
		} else if (req.url.substr(0, 10) === "/lazybones") {
			mime = mimes[path.extname(fpath)];
			fpath = resolve(".." + req.url);
		} else {
			mime = mimes[".html"];
			fpath = resolve("test/browser/test.html");
		}

		res.setHeader("Content-Type", mime);
		fs.createReadStream(fpath, "utf-8").pipe(res);
	});
});

server.listen(8000, function() {
	console.log("Test server listening on port 8000.")
});