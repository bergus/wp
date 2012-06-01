mw.Api.Bot = function(api, name, passwort) {
	var inited = false,
		sessionsettings = null,
		bot = this;
	this.api = api;
	this.p = api.act("login", {name: name, password: passwort || ""}).then(function(){
		return api.query({
			siteinfo:{prop:["general","namespaces","namespacealiases"/*,"specialpagealiases","magicwords","interwikimap","dbrepllag","statistics","usergroups"*/,"extensions"/*,"fileextensions","rightsinfo","languages","skins","extensiontags","functionhooks","showhooks"*/]},
			userinfo:{prop:["blockinfo","hasmsg"/*,"groups","implicitgroups"*/,"rights"/*,"changeablegroups"*/,"options"/*,"preferencestoken"*/,"editcount","ratelimits"/*,"email","realname","acceptlang","registrationdate"*/]},
			info:{token:["edit","watch"]},titles:"Main Page"/*,
			watchlist:{end: lastlogin }*/
		});
	}).onSuccess(function initBot(res) {
		sessionsettings = res;
		bot.user = res.userinfo;
		api.settings.highlimits = bot.rights.contains("bot"); // :-)
		bot.assertEdit = res.extensions.some(function(e) { return e.name == "AssertEdit"; });
		bot.namespaces = res.namespaces;
		bot.formattedNamespaces = {};
		bot.namespaceids = {};
		for (var nsid in bot.namespaces) {
			if (typeof bot.namespaces[nsid].content == "string") bot.namespaces[nsid].content = true;
			if (typeof bot.namespaces[nsid].subpages == "string") bot.namespaces[nsid].subpages = true;
			bot.formattedNamespaces[nsid] = bot.namespaces[nsid]['*'];
			bot.namespaceids[bot.namespaces[nsid]['*']] = nsid;
			if (typeof bot.namespaces[nsid].canonical == "string")
				bot.namespaceids[bot.namespaces[nsid].canonical] = nsid;
		}
		for (var i=0; i<res.namespacealiases.length; i++)
			bot.namespaceids[res.namespacealiases[i]['*']] = res.namespacealiases[i].id;
		for (var pageid in res.pages)
			bot.edittoken = res.pages[pageid].edittoken;
		inited = true;
	}).onError(function(mes, res, err) {
		alertabout(err, err.name, 3);
	});
};
Object.extend(mw.Api.Bot.prototype, {
	get name() { return this.user.name; },
	get rights() { return this.user.rights; },
	edit: function(what, how, options) {
		var todo,
			interesting = new mw.Api.Query({
				"info": {token:"edit",prop:["protection","preload","displaytitle"]},
				"revisions": {prop:["ids","timestamp","size","content"], limit:undefined}, // {nomax:true}
				"pageprops": {prop:["defaultsort","notoc","displaytitle","nonewsectionlink","noindex","forcetoc","noeditsection","newsectionlink","notitleconvert","nogallery","index","hiddencat","staticredirect"]} // [[mw:Manual:Page props table]]
			}),
			options = options || {};
			api = this.api,
			bot = this;
		if (what instanceof Promise.Stream)
			todo = what.mapPromise(checkForPageValues);
		else if (what instanceof Promise)
			todo = what.each(checkForPageValues);
		else if (what instanceof mw.Api.Query)
			todo = api.stream(Object.merge(what.toGenerator(), interesting));
		else if (Array.isArray(what))
			todo = api.stream(Object.extend(interesting, {source:typeof what[0]=="number" ? "pageids" : "titles", set:what}));
		else
			throw new TypeError("mw.Api.Bot.edit: what ("+typeof what+") can't be resolved to a valid pageset");
		
		var i=0;
		function tick() {
			return Promise.wait(60*1000/(options.epm || 5)*i++).onSuccess(function(){i--;});
		}
		return todo.mapPromise(function editdetails(page) {
			if (Object(page) !== page) return about(page, "mw.Api.Bot.edit|editdetails: invalid page parameter");
			if (options.filter && !options.filter(page)) return "cancelled by filter";
//console.debug(page.title, page.protection);
			if (page.protection && page.protection.some(function(p) {
				return p.level == "sysop" && p.type == "edit";
			})) return logabout(page.title + " ist gesperrt");
//console.debug(page);
			
			if (page.invalid) return new Error("invalid page title '"+page.title+"'");
			var missing = typeof page.missing == "string",
				title = page.title,
				token = page.edittoken,
				sts = page.starttimestamp,
				bts = missing ? false : page.revisions[0].timestamp,
				content = page.text = missing ? null : page.revisions[0]["*"];
			if (token != bot.edittoken)
				alertabout([bot.edittoken, token], "different Tokens!");
			return new Promise(how).arg(page).then(function edit(p) {
				if (Object(p) !== p)
					return p || "cancelled by edit method";
				if ((p.text == content || !p.text) && !p.prependtext && !p.appendtext)
					return "nothing changed ("+title+")";
				var editparams = Object.extend(p, {
					action:"edit",
					title: title,
					token: token,
					starttimestamp: sts,
					basetimestamp: bts,
					bot: true
				});
				if (bot.assertEdit)
					editparams.assert = bot.rights.contains("bot") ? "bot" : "user";
				editparams[missing ? "createonly" : "nocreate"] = true;
				if (!options.diff) {
					if (options.safe) {
						console.debug(editparams);
						return "logged";
					} else {
console.log("Going to edit "+editparams.title);
						return tick().then(api.promise(editparams));
					}
				}
				return api.query("revisions", {difftotext: p.text}, {revids:page.revisions[0].revid}).then(function(diff) {
					if (options.safe) {
						console.debug(diff);
						return "diff logged";
					} else {
						if (typeof options.diff == "function" || options.diff instanceof Promise)
							return new Promise(options.diff).then(tick()).then(api.promise(editparams));
						return tick().then(api.promise(editparams));
					}
				});
			});
		}, 1);
	},
	replaceTemplate: function replaceTemplate(title, fn, opt) {
		opt = opt || {};
		var b = this;
		if (typeof opt.join != "string") opt.join = "\n ";
		return function(page) {
			//if (page.title.beginsWith("Vorlage:"))
			//	return "Vorlage "+page.title+" wird nicht bearbeitet";
			return {text: b.wikitext.formatTemplate(page.text, title, function(p, title, template, opt) {
				return fn(p, page, opt.reihenfolge, template);
			}, opt), summary: opt.summmary || "Bot: Umstellung der [[Vorlage:"+title+"]]"};
		};
	},
	wikitext: {
		formatTemplate: function formatTemplate(text, title, fn, opt) {
			if (typeof fn != "function") {
				opt = fn;
				fn = undefined;
			}
			opt = opt || {};
			var templateRegexp = new RegExp("{{\\s*"+(title.contains(":")?"(?:Vorlage:|Template:)?"+title:title)+"([^[\\]{}]*(?:{{[^{}]*}}|\\[?\\[[^[\\]]*\\]?\\])?[^[\\]{}]*)+}}", "g");
			var paramRegexp = /\s*\|[^{}|]*?((?:{{[^{}]*}}|\[?\[[^[\]]*\]?\])?[^[\]{}|]*)*/g;
			return text.replace(templateRegexp, function(template){
				// logabout(template, "input ");
				var parameters = template.match(paramRegexp);
				if (!parameters) {
					console.log(page.title + " ohne Parameter:\n" + template);
					parameters  = [];
				}
				var unnamed = 1;
				var p = parameters.toObject(function(map, line) {
					line = line.replace(/^\s*\|/,"");
					var i = line.indexOf("=");
					map[line.substr(0,i).trim() || unnamed++] = line.substr(i+1).trim();
				});
				if (fn)
					p = fn(p, title, template, opt);
				var ps = Object.keys(p);
				if (opt.reihenfolge)
					ps = opt.reihenfolge.filter(ps.contains.bind(ps));
				var m = ps.reduce(function(m, x){return Math.max(m, x.length)}, 0)+1; // 1+ps.get("length").max();
				var unnamed = 1;
				return logabout("{{"+(opt.newtitle||title) + ps.map(function(x){ 
					var name = opt.join.contains("\n") ? " "+x.padright(m)+"= " : x+"=";
					if (x == unnamed && p[x].indexOf("=")==-1) {
						name = opt.join.contains("\n") ? " " : "";
						unnamed++;
					}
					return opt.join+"|"+name+p[x]; 
				}).join("") + opt.join.substring(0, -1) + "}}", "mw.bot.wikitext.formatTemplate|result");
			});
		}
	}
});

mw.Api.handleMaxlag = new Promise.Process(function handleMaxlag(error, sc, ec, mc) {
// buggy, does not work correctly
	console.debug(error);
	if (error.message == "maxlag") {
		var info = error.details.info;
		mc(info+" (@"+error.result.servedby+")");
		info = info.match(/Waiting for (.+?): (\d) seconds lagged/);
		if (!info)
			return error; // weiterwerfen
		var ms = 2000 * (parseInt(info[2], 10)+1);
		return Promise.wait(ms).then(error.origin.clone()).correct(handleMaxlag);
	} else
		return error; // weiterwerfen
});