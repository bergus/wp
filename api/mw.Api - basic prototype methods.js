Object.extend(mw.Api.prototype, {
	promise: function(query, settings, full) {
/* get: mixed query[, Object settings][, boolean full]
		rejects in case of ajax error, or in case of detecting an error or warning(s) in the result
		resolves with the requested data, if full===true returns the whole result
return: a Promise to request the given query, optional with settings */
		var api = this;
		return new Promise(function apipromisefn(sc, ec) {
			api.request(query, function(result) {
//alertabout(result,"promiseresult",5);
				if (result.error)
					ec(result.error.code, result.error, result);
				else if (result.warnings)
					ec("warnings for "+Object.keys(result.warnings).join(", "), result.warnings, result); // not sure, as we have a valid result?
				else if( ! result[query.action]) {
					if (query.action == "query" && (typeof query.prop == "string" || query.prop && query.prop.length > 0)) // Bug 31901
						sc(full ? Object.set(result, "query", {pages:{}}) : {pages:{}});
					else
						ec("missing_"+query.action+"-element", "no "+query.action+"-element found", result);
				} else
					sc(full ? result : result[query.action]);
			}, function(status, statusText) {
				if (this.responseXML) {
					var xml = this.responseXML;
					if (!xml.documentElement) // new XMLSerializer().serializeToString(xml).indexOf("<html")==-1 Passiert manchmal
						//xml = new DOMParser().parseFromString(this.response, "text/html"); // NOT_SUPPORTED_ERR
						ec(status, statusText, {invalidXHTML: true, reasonHTML: this.response});
					else
						ec(status, xml.getElementsByTagName("title")[0].textContent + " ("+statusText+")", {reasonHTML: (xml.querySelector("body div.ContentArea") || xml.querySelector("body h3") || {}).innerHTML}) 
				}
				ec(status, statusText, this.responseText || this);
			}, settings);
		}, {spread:true});
	},
	act: Object.extend( function(aktion, params) { // Alles was zum Posten verpflichtet ist und üblicherweise auch ein Token erfordert
//namen von mustbeposted-modulen: ["block","delete","edit","emailuser","import","login","move","patrol","protect","review","rollback","stabilize","unblock","undelete","upload","userrights"]
//werte für intoken: ["block","delete","edit","email","import","move","protect","unblock"]
/*parameter von modulen mit "token"-parameter:
block: allowusertalk|anononly|autoblock|expiry|gettoken|hidename|nocreate|noemail|reason|reblock|token|user|watchuser
delete: oldimage|pageid|reason|title|token|unwatch|watch|watchlist
edit: appendtext|assert|basetimestamp|bot|captchaid|captchaword|createonly|md5|minor|nassert|nocreate|notminor|prependtext|recreate|redirect|section|starttimestamp|summary|text|title|token|undo|undoafter|unwatch|watch|watchlist
emailuser: ccme|subject|target|text|token
import: fullhistory|interwikipage|interwikisource|namespace|summary|templates|token|xml
login (prefix lg): domain|name|password|token
move: from|fromid|ignorewarnings|movesubpages|movetalk|noredirect|reason|to|token|unwatch|watch|watchlist
patrol: rcid|token
protect: cascade|expiry|protections|reason|title|token|watch|watchlist
review: comment|flag_accuracy|revid|token|unapprove
rollback: markbot|summary|title|token|user|watchlist
stabilize: autoreview|default|expiry|reason|review|title|token|watch
unblock: gettoken|id|reason|token|user
undelete: reason|timestamps|title|token|watchlist
upload: asyncdownload|comment|file|filekey|filename|ignorewarnings|leavemessage|sessionkey|stash|statuskey|text|token|url|watch|watchlist
userrights: add|reason|remove|token|user
watch: title|token|unwatch
*/
		var tokenbyactions = {
			"block":true, /*auch own: gettoken*/
			"unblock":true, /*auch own: gettoken*/
			"delete":true,
			"edit":true,
			"emailuser":"email", // klingt logisch
			"import":true,
			"move":true,
			"protect":true,
			"undelete":"edit", // meines Wissens
			"upload":"edit", // laut parameter-Doku
			"review":"edit" // laut parameter-Doku
			//"watch": true // dürfte so kommen (1.18)
		};
		var spezialtokens = ["login","patrol","rollback","stabilize","userrights"];
		//api.php ?action=query&prop=revisions&rvtoken=rollback&titles=XXX
		//api.php?action=query&list=users&ustoken=userrights&ususers=XXX
		//api.php?action=query&list=recentchanges&rctoken=patrol&rclimit=1 (per login)
		if (typeof tokenbyactions[aktion] == "undefined") {
			if (spezialtokens.contains(aktion)) {
				if(typeof this.act[aktion] == "function")
					return this.act[aktion].apply(this, Array.prototype.slice.call(arguments,1));
				throw new Error("mw.Api.act: Die Aktion "+aktion+" wird leider noch nicht unterstützt");
			}
			throw new Error("mw.Api.act: unbekannte Aktion "+aktion);
		}
		var tokentype = (tokenbyactions[aktion]===true) ? aktion : tokenbyactions[aktion];
		
		var pageparam = {
			"block": function(p){return "User:"+p.user;}, // ?
			"delete":  [/* "oldimage", */"pageid", "title"],
			"edit": "title", /*basetimestamp (revid), starttimestamp*/
			"emailuser": function(p){return "User:"+p.target;},
			"import": 2103/* Main Page */, // oder einfach Math.random(1e6) :-)
			"move": "to", /* from, fromid */
			"protect": "title",
			"review": "revid",
			//"rollback": "title",
			//"stabilize": "title",
			"unblock": function(p){return "User:"+p.user;}, // ?
			"undelete": "title",
			"upload": "filename",
			//"userrights": function(p){return "User:"+p.user;},
			"watch": "title"
		}[aktion];
		var page;
		if (typeof pageparam == "function") {
			page = pageparam(params);
			pageparam = pageparam.name || "title";
		} else if (typeof pageparam == "number") {
			page = pageparam;
			pageparam = "pageid";
		} else {
			if (Array.isArray(pageparam))
				for (var i=0; i<pageparam.length; i++)
					if (params[pageparam[i]]) {
						pageparam = pageparam[i];
						break;
					}
			page = params[pageparam]
		}
		var api = this;
		
		// Warum auch immer man für z.B. action=import mit intoken=import eine Query-Seite angeben muss
		return this.query("info", {token:tokentype}, page).then(function(pageres) {
			params.token = pageres[tokentype+"token"];
			params.action = aktion;
			return api.promise(params, {method:"post"}).onSuccess(function(res){alertabout(res);});
		});
	}, {
		login: function(params) {
			var api = this;
			return api.promise({action:"login", lgname:params.name, lgpassword:params.password}, {method:"post"}).then(function loginfn1(res1){
				if (res1.token)
					return api.promise({action:"login", lgname:params.name, lgpassword:params.password, lgtoken:res1.token}, {method:"post"}).syncThen(function loginfn2(res2){
//console.debug("mw.Api.act(login)|secondresult", res2);
						if (res2.result && res2.result == "Success")
							return true;
						return Object.extend(new Error("login failed"), {"details": ""+res2.result, "result":res2});
					}).onError(function(e, d){
console.log("mw.Api.act: "+e+" due '"+d+"'");
					}).correct(function(e, sc, ec, m){
						if (e.details != "Throttled")
							return e;
						m("mw.Api.act: login throttled, next login in "+e.result.wait+"s");
						return loginfn1(res1).defer(e.result.wait*1000);
					});
				return Object.extend(new Error("noToken"), {"details": res1.result, "result":res});
			}); //.onSuccess(console.debug.pcall("mw.Api.act(login)|firstresult"));
		},
		rollback: function(params) {
		}
	}),
	edit: function(params, getparams){ // als wichtigste Funktion nicht nur über act("edit") abfackeln
/* get: (title | pageid)[, section][, text | prependtext | appendtext][, summary][, minor][, notminor][, bot][, recreate][, createonly][, nocreate][, watchlist][, captchaid, captchaword][, undo[, undoafter]]
return: Promise to edit (or reject :-) */
		var api = this;
		if (typeof params == "string")
			params = {title: params};
		if (typeof params == "number")
			params = {pageid: params};
		
		var title, token, sts, bts, content;
		return api.query( {
			"info": {token:"edit",prop:["protection","preload","displaytitle"]},
			"revisions":{prop:["ids","timestamp","size","content"], section:params.section, limit:undefined}, // {nomax:true}
			"pageprops": {prop:["defaultsort","notoc","displaytitle","nonewsectionlink","noindex","forcetoc","noeditsection","newsectionlink","notitleconvert","nogallery","index","hiddencat","staticredirect"]} // [[mw:Manual:Page props table]]
		}, params.pageid || params.pageids || params.title || params.titles).syncThen(function(page) {
			if (typeof page.missing != "undefined")
				return new Error("mw.Api.edit: missing page: "+(params.pageid || params.pageids || params.title || params.titles));
			title = page.title;
			token = page.edittoken;
			sts = page.starttimestamp;
			bts = page.revisions[0].timestamp;
			page.text = content = page.revisions[0]["*"];
			return page;
		}).then(getparams/* || false */).then(function edit(p){
			var editparams = Object.extend(	Object.extend(params, p), {
				action:"edit",
				token: token,
				starttimestamp: sts,
				basetimestamp: bts
			} );
			return api.promise(editparams);
		});
	}
});