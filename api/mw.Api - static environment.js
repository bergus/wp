mw.Api.Settings = {
/* Prototyped settings object. The settings can be overwritten for each mw.Api object, and for each request() */
	//type: 'local',
	method: "POST",
	contentType: "application/x-www-form-urlencoded",
	asynchronous: true,
	format: "json",
	getRemoteUrl: function(fn_name) {
		return "format=json&callback="+fn_name;
	},
	get: 2, // welche Parameter werden als GET übertragen? 0:keiner, 1:action, 2:action&query, 3:action&format, >3 action&query&format. Nutze method="GET" für alle
	timeout: 10*1000, // Millisekunden
	callback: function(e, url, data) {
/* get: (Event-)Object (mindestens mit Schlüssel type), String Url des Requests, mixed query-daten
called: on XMLHttpRequest oder HTMLScriptElement, beide haben eine Eigenschaft readyState
return: void */
//console.log("mw.Api.request '"+url+"': "+ (this instanceof XMLHttpRequest ? "XHR" : "Script")+" "+e.type+", "+this.readyState);
	},
	accept: {
/* Available Parsers. They get the xhr object, and must return an Object with a key 'error' when an error was detected, with a key 'warnings' when a warning was detected and the 'data containing element' in a property keyed with that element's name */
		'json': function(xhr) {
			return JSON.parse(xhr.responseText);
		},
		'xml': function(xhr) {
			var dom = xhr.responseXML.documentElement;
			var e, w;
			if ((e = dom.getElementsByTagName('error')).length > 0)
				dom.error = Object.set(e, "code", e[0].getAttribute('code'));
			if ((w = dom.getElementsByTagName('warning')).length > 0)
				dom.warnings = Array.prototype.reduce.call(w, function(map, w){ return Object.set(map, w.getAttribute('code'), w); }, {});
			dom[dom.lastChild.nodeName] = dom.lastChild;
			return dom;
		}
	},
	maxquerycontinue: 25,
	querycache: 5*60, // 5 Minutes
	maxURIlength: 2000, // maximum character length for serialized query parameters - when above they will get POSTed
// http://bots.wmflabs.org/~petrb/logs/%23wikimedia-operations/20120424.txt:
// [21:29:37] <RoanKattouw>	 Does anyone know at what URL length Squid will return ERR_TOO_BIG?
// [21:29:49] <RoanKattouw>	 Someone in -dev triggered it with a long API request and he's wondering what the limit is
// [21:45:50] <binasher>	 RoanKattouw: I think it's 8k but might only be 4k
	highlimits: false
};
Object.extend(mw.Api, { // /includes/api/ApiBase.php
	limitBigLow: 500, // Fast query, std user limit
	limitBigHigh: 5000, // Fast query, bot/sysop limit
	limitSmallLow: 50, // Slow query, std user limit
	limitSmallHigh: 500 // Slow query, bot/sysop limit
});


// das ist eine essentielle Funktion und steht daher nicht erst weiter unten zusammen mit anderen Erweiterungen des mw.Api-Namensraums
mw.Api.serializeQuery = function(q) {
/* get: [String, Array, Object] query
		in case query is a String: everything except the first equals sign (=) is encoded
		in case query is an Array: function works recursive and joins the results into the list
		in case query in an Object: each key gets a parameter name with argument...
			in case property is undefined: is dropped
			in case property is boolean: "1" for true, "0" for false
			in case property is an Array: values are joined with "|" (because this is often used) !!!
			in case property is an Object: gets serialized with its (inherited) toString method
		every other type raises an Error!
return: a encoded, &-joined parameter=argument-list String */
	if (typeof q == "string") {
		q = q.split("=");
		if (q.length > 1)
			return encodeURIComponent(q.unshift())+"="+encodeURIComponent(q.join("="));
		return encodeURIComponent(q[0]);
	}
	if (Array.isArray(q))
		return q.map(that.serializeQuery).join("&");
	if (typeof q == "object" && q !== null)
		return Object.toArray(q, function(key, val) {
			if (typeof val == "undefined")
				return false;
			var ukey = encodeURIComponent(key)+"=";
			if (typeof val == "boolean")
				return ukey + (val?"1":"0"); // sicher 0 ?
			if (Array.isArray(val))
				return ukey + encodeURIComponent(val.join("|"));  // oder besser val.map(encodeURIComponent).join("|") ?
			if (typeof val == "object") {
				if (typeof val.toString == "function") // Date-Object?
					return ukey + encodeURIComponent(val.toString());
				throw new TypeError("mw.Api.serializeQuery: query-Parameterwert ("+key+") darf kein nicht serialisierbares Objekt sein");
			}
			return ukey + encodeURIComponent(val); // automatische Typumwandlung
		}).filter(function(x){return Boolean(x);}).join("&");
	throw new TypeError("mw.Api.serializeQuery: query muss ein String, Array oder Objekt sein");
};