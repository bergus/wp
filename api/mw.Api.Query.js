Object.extend(mw.Api.prototype, {
	stream: function streamQuery(was, params, generatorparams, spezial) {
/* get: [Query, mixed (see Query constructor)] arguments
return: a Promise.Stream calling for each new item of the requested data */
		var api = this;
		var query = was instanceof this.constructor.Query
			? was
			: new this.constructor.Query(was, params, generatorparams, spezial);
//console.debug(query); // insbesondere bei set-splitting
		if (query.features["exportnowrap"])
			throw new Error("mw.Api.stream: exportnowrap wird nicht unterstützt!");
		if (query.auswahl.meta)
			throw new Error("mw.Api.stream: meta information ("+query.auswahl.meta+") can't be streamed");
		var conf = Array.isArray(query.unrecognized)
			? query.unrecognized.toObject(function(m, val){m[val]=true;})
			: query.unrecognized;
		if (! conf.nomax)
			query.maximizeLimits();
		
		var setlimit = this.settings.highlimits ? 500 : 50,
			cache = typeof conf.cache == "number" ? conf.cache : this.settings.querycache,
			maxrequests = this.settings.maxquerycontinue;
			
		var running = 0;
		return new Stream(function(p, callback, e, m) {
			var requests = query.getRequests(false, false, setlimit);
			if (!requests)
				e("empty", "nothing to request");
			return Promise.merge(requests.map(function mapper(request) {
				running++;
				return api.promise(Object.extend(request.params, request.base, {
					smaxage: cache,
					maxage: cache
				}), {format: "json", method:"GET" /* for Caching */}, true).then(function apiQueryCallback(result, success) {
					running--;
					var r = result.query;
console.debug("mw.Api.stream: one result", r, query);
					if (query.auswahl.prop)
						for (var i in r.pages)
							callback(r.pages[i]);
					if (query.auswahl.list)
						for (var i=0; i<query.auswahl.list.length; i++)
							r[query.auswahl.list[i]].forEach(callback);
					
					var qc = result['query-continue'];
					if (--maxrequests > 0 && !conf.nocontinue && qc) {
						var requests = query.getRequests(qc, request);
						if (requests)
							return Promise.merge(requests.map(mapper));
					} else
						success( qc );
					if (!running)
						callback(); // Ende
				});
			})).onError(e).onMessage(m).start();
		});
	},
	query: function(was, params, generatorparams, spezial) {
/* get: [Query, mixed (see Query constructor)] arguments
nice test case: http://de.wikipedia.org/w/api.php?format=xml&action=query&generator=templates&prop=categories|templates&list=allpages&gtllimit=5&cllimit=4&tllimit=1&titles=Wikipedia:Hauptseite
return: Promise to get the spezified data */
		var api = this;
		var query = was instanceof this.constructor.Query
			? was
			: new this.constructor.Query(was, params, generatorparams, spezial);
		
		var conf = Array.isArray(query.unrecognized)
			? query.unrecognized.toObject(function(m, val){m[val]=true;})
			: query.unrecognized;
		if (query.features["exportnowrap"])
			throw new Error("mw.Api.query: exportnowrap wird nicht unterstützt!");
		if (! conf.nomax)
			query.maximizeLimits();
		var setlimit = this.settings.highlimits ? 500 : 50,
			cache = typeof conf.cache == "number" ? conf.cache : this.settings.querycache,
			queryresult = {},
			missingpages = [],
			maxrequests = this.settings.maxquerycontinue;
		
		var continuesteps = [];
		return (function doRequest(qc, cur, setlimit) {
			var requests = query.getRequests(qc, cur, setlimit);
			if (!requests) {
				delete continuesteps[cur.params.requestid];
				return {}; // Ende
			}
			var promises = [];
			for (var i=0; i<requests.length; i++) {
				if (requests[i] != cur)
					continuesteps.push(requests[i]);
				promises.push(api.promise(Object.extend(requests[i].params, requests[i].base, {
					requestid: continuesteps.indexOf(requests[i]),
					smaxage: cache,
					maxage: cache
				}), {format: "json", method:"GET" /* for Caching */}, true).then(function apiQueryCallback(result, success) {
console.debug("mw.Api.query: one result", result);
					if (result.query.pages)
						for (var i=-1; result.query.pages[i]; i--) {
							var id = result.query.pages[i].ns + result.query.pages[i].title;
							if (!missingpages.contains(id)) {
								missingpages.push(id);
								result.query.pages[-missingpages.length] = result.query.pages[i];
							}
							if (missingpages.length != -i)
								delete result.query.pages[i];
						}
					if (Object.isEmpty(queryresult))
						queryresult = result.query;
					else
						Object.combine(queryresult, result.query);
					
					var id = result.requestid;
					var qc = result['query-continue'];
					if (--maxrequests > 0 && !conf.nocontinue && qc)
						return doRequest(qc, continuesteps[id]);
					else
						success( qc ? Object.set({},id,qc) : {} );
				}));
			}
			return Promise.merge(promises, true);
		})(false, false, setlimit).syncThen(function handleResult(branchconclusion) {
console.debug("mw.Api.query: final result ("+missingpages.length+" missing"
			+ ", continue: " + Object.join(branchconclusion, ", ", function(k,v){return k+": "+Object.keys(v).join("-");})
			+ ")", queryresult, query);
			if (Object.keys(queryresult).some(function(k) { return ["pages", "interwiki", "converted", "normalized", "redirects"].indexOf(k) == -1;})) { // gibt es Ergebnisse, die nichts mit props (<pages>) zu tun haben?
				if (queryresult.pages || queryresult.interwiki || queryresult.redirects) // gibt es auch props (<pages>)?
					return queryresult;
				if ((query.auswahl.list || []).length + (query.auswahl.meta || []).length == 1) // gibt es genau ein list- oder meta-Ergebnis?
					return queryresult[query.auswahl.list ? query.auswahl.list[0] : query.auswahl.meta[0]];
				return queryresult;
			}
			
			if (conf.nopageset)
				return queryresult.pages;
			if (!conf.nosinglepage && query.set.length == 1 && !query.auswahl.generator) {
				for (var i in queryresult.pages)
					return queryresult.pages[i];
				for (var i in queryresult.interwiki)
					return queryresult.interwiki[i];
			}
			if (conf.asArray)
				return queryresult.interwiki
					? Object.values(queryresult.pages || {}).concat(Object.values(queryresult.interwiki))
					: Object.values(queryresult.pages);
			var pagesbytitle = {};
			for (var i in queryresult.pages)
				pagesbytitle[queryresult.pages[i].title] = queryresult.pages[i];
			for (var i in queryresult.interwiki)
				pagesbytitle[queryresult.interwiki[i].title] = queryresult.interwiki[i];
			if (conf.bytitle)
				return pagesbytitle;
			if (query.source != "titles" || !query.source) // richtig für pageids, wie sieht es aber mit revids aus?
				return queryresult.pages; // queryresult.badrevids !!!
			var pagesbyinput = {},
				convert = {},
				normalize = {},
				redirect = {};
			if (queryresult.converted)
				for (var i=0; i<queryresult.converted.length; i++)
					convert[queryresult.converted[i].from] = queryresult.converted[i].to;
			if (queryresult.normalized)
				for (var i=0; i<queryresult.normalized.length; i++)
					normalize[queryresult.normalized[i].from] = queryresult.normalized[i].to;
			if (conf.redirects && queryresult.redirects)
				for (var i=0; i<queryresult.redirects.length; i++)
					redirect[queryresult.redirects[i].from] = queryresult.redirects[i];
			for (var i=0; i<query.set.length; i++) {
				var s = query.set[i];
				var ziel = s.replace(/_/g," ");
				if (normalize[ziel])
					ziel = normalize[ziel];
				/* else */if (convert[ziel])
					ziel = convert[ziel];
				if (redirect[ziel]) {
					pagesbytitle[redirect[ziel]]['redirectedfrom'] = ziel;
					if (redirect[ziel].tofragment)
						pagesbytitle[redirect[ziel]]['tofragment'] = redirect[ziel].tofragment;
					ziel = redirect[ziel].to;
				}
				pagesbyinput[s] = pagesbytitle[ziel];
			}
			return pagesbyinput;
		});
	}
});

mw.Api.Query = function(was, params, generatorparams, spezial) {
/* get: (Object | String module[, Object moduleparams])[, Object generatorparams (wenn zuvor spezifiziert) bzw. generator mit generatormodulname als key][, spezialparams]
		this.auswahl:                  object with optional keys representing "what" is getting queried
		            .[prop|list|meta]: Array with names of the called components (querymodules)
		            .generator:        name of the querymodule used as generator
		this.query:                    object with parameters for each querymodule, keyed by the prefix of the module (including "g" for generator)
		this.set:                      Array with titles/pageids/revids to work on
		this.source:                   string for the dataSource of set (titles|pageids|revids)
		this.features:                 general parameters to the Query module, like "redirects", "converttitles" or "export" stuff
		this.unrecognized:             every unknown property in all arguments - parameters by querymodule not yet checked
		throws an Error when there is no generator or (page)set!
return: an open interface Object to represent the structure of requests to the Query module of MediaWiki's API */
	
	// handle parameter overload
	if (typeof was == "object") { // != "string"
		spezial = generatorparams;
		generatorparams = params;
		params = was;
	} else if (typeof was == "string") {
		params = Object.set({}, was, params);
	} else if (typeof was == "undefined") {
		params = {};
	} else ;
//console.log("mw.Api.Query: parameter "+typeof was+" 'was' is ignored");
	if (typeof generatorparams != "object" || Array.isArray(generatorparams) ) {
		spezial = generatorparams;
		generatorparams = {};
	}
	if (typeof spezial == "string")
		spezial = {titles: spezial};
	else if (typeof spezial == "number")
		spezial = {pageids: spezial};
	else if (typeof spezial != "object") // mit boolean, function oder undefined ist nichts anzufangen
		spezial = {};
	
	// determine generator and query modules
	this.auswahl = {};
	this.query = {};
	if (params.generator || generatorparams.generator) {
		this.auswahl.generator = params.generator || generatorparams.generator;
		if (params.generator && !generatorparams[this.auswahl.generator]) {
			params[this.auswahl.generator] = generatorparams;
			generatorparams = {};
		} else if (generatorparams.generator) {
			delete generatorparams.generator;
			generatorparams = Object.set({}, this.auswahl.generator, generatorparams);
		}
	} else {
		for (var gen in generatorparams) {
			if (this.parameters.generators.indexOf(gen) > -1) {
				if (this.auswahl.generator)
					throw new Error("mw.Api.Query: es kann nur ein Generator pro Abfrage genutzt werden (hier: "+auswahl.generator+" und "+gen+")");
				this.auswahl.generator = gen;
			}
		}
	}
	function checkparam(p, v) {
		var typ = this.parameters.types[p];
		if (typ) {
			var pref = this.parameters.prefixes[p];
			if ( this.auswahl.generator && this.auswahl.generator == p) {
				pref = "g"+pref;
			} else {
				if ( !this.auswahl[typ])
					this.auswahl[typ] = [];
				this.auswahl[typ].push(p);
			}
			if (Array.isArray(v))
				v = v.toObject(function(m, p){m[p]=true;});
			this.query[pref] = v; // store by prefix because of possible duplicate (generator ? prop)
		} else {
//console.log(about(v, "nicht erkannter Parameter: "+p+", wird spezial"+(typeof spezial[p] == "undefined"?" ":" nicht ")+"zugeordnet"));
			if (typeof spezial[p] == "undefined")
				spezial[p] = v;
		}
	}
	for (var i in params)
		checkparam.call(this, i, params[i]);
	for (var i in generatorparams)
		checkparam.call(this, i, generatorparams[i]);
	
	// determine pageset
	this.set = [];
	this.source = false;
	this.parameters.sources.forEach(function(s) {
		if (typeof spezial[s] == "undefined")
			return;
		if (this.set.length) // this.source
			throw new Error("mw.Api.query: Es darf nur einer der Parameter titles, pageids und revids vorhanden sein");
		this.set = Array.isArray(spezial[s]) ? spezial[s] : (""+spezial[s]).split("|");
		delete spezial[s];
		this.source = s;
	}, this);
	/* Only when generating http parameters
	if (!this.source && this.auswahl.prop && (!this.auswahl.generator || this.parameters.prefixes[this.auswahl.generator]=="prop"))
		throw new Error("mw.Api.query: Es muss genau einer der Parameter titles, pageids und revids vorhanden sein");
	*/
	// ... and special params
	this.features = {};
	this.parameters.features.forEach(function(s) {
		if (typeof spezial[s] == "undefined") // must be even boolean?
			return;
		this.features[s] = spezial[s];
		delete spezial[s];
	}, this);
	this.unrecognized = spezial;
};
Object.extend(mw.Api.Query.prototype, {
	// constructor: mw.Api.Query,
	parameters: (function() {
// module overview (should be based on a query, I know, and should be specific for a mw.Api object)
		var params = {
			generators: ["allimages","allpages","alllinks","allcategories","allusers","backlinks","blocks","categorymembers","deletedrevs","embeddedin","filearchive","imageusage","iwbacklinks","logevents","recentchanges","search","tags","usercontribs","watchlist","watchlistraw","exturlusage","users","random","protectedtitles","oldreviewedpages","globalblocks","abuselog","abusefilters","reviewedpages","unreviewedpages","info","revisions","links","iwlinks","langlinks","images","imageinfo","stashimageinfo","templates","categories","extlinks","categoryinfo","duplicatefiles","pageprops","flagged","globalusage"],
			sources: ["titles", "pageids", "revids"],
			features: ["redirects", "converttitles", "indexpageids", "export", "exportnowrap", "iwurl"],
			types: {},
			prefixes: {}
		};
		var typen = {
			"prop":{"categories":"cl","categoryinfo":"ci","duplicatefiles":"df","extlinks":"el","flagged":"","globalusage":"gu","imageinfo":"ii","images":"im","info":"in","iwlinks":"iw","langlinks":"ll","links":"pl","pageprops":"pp","revisions":"rv","stashimageinfo":"sii","templates":"tl"},
			"list":{"abusefilters":"abf","abuselog":"afl","allcategories":"ac","allimages":"ai","alllinks":"al","allpages":"ap","allusers":"au","backlinks":"bl","blocks":"bk","categorymembers":"cm","deletedrevs":"dr","embeddedin":"ei","exturlusage":"eu","filearchive":"fa","globalblocks":"bg","imageusage":"iu","iwbacklinks":"iwbl","logevents":"le","oldreviewedpages":"or","protectedtitles":"pt","random":"rn","recentchanges":"rc","reviewedpages":"rp","search":"sr","tags":"tg","unreviewedpages":"ur","usercontribs":"uc","users":"us","watchlist":"wl","watchlistraw":"wr"},
			"meta":{"allmessages":"am","globaluserinfo":"gui","siteinfo":"si","userinfo":"ui"}
		};
		for (var typ in typen) {
			for (var m in typen[typ]) {
				params.types[m] = typ;
				params.prefixes[m] = typen[typ][m];
			}
		}
		return params;
	})(), // just for shorter listing
	toString: function() {
/* returns a String describing the Query object */
		var r = about(this.auswahl,"mw.Api::Query:\nmodule",2) + about(this.query, "\nquery",2);
		if (this.source)
			r += about(this.set,"\n"+this.source,1);
		if (Object.keys(this.unrecognized).length)
			r += about(this.unrecognized, "\nunrecognized",2);
		return r;
	},
	validateParams: function() {
//console.log(this);
		// generator properties are useless, only pageid|ns|title will be listed
		if (Object.keys(this.auswahl).length < 1) // ein generator-modul liefert auch etwas
			throw new Error("mw.Api::Query: leere Abfrage");
		if (!this.source && this.auswahl.prop && (!this.auswahl.generator || this.parameters.types[this.auswahl.generator] == 'prop'))
			throw new Error("mw.Api::Query: Es muss genau einer der Parameter titles, pageids und revids vorhanden sein");
	},
	getQueryParams: function() {
/* get: number index to start from, number how many items of the set
return: a plain, independent (cloned) Object with all url parameters needed for a query
deprecated! */
		this.validateParams();
		var q = this.getParams(true, true);
		if (this.source)
			q[this.source] = this.set.slice(0);
		Object.extend(q, this.features);
		return q;
	},
	getParams: function getParams(prop, ind) {
/* get: property- (und impliziert auch generator-) parameter ausgeben, list- und meta-parameter (independent) ausgeben
return: a plain url parameter object */
		var q = Object.extend({action:"query"}, this.features); // better: Object.set(Object.clone(this.features, true), "action", "query")
		for (var t in this.auswahl) {
			if (!prop && (t=="generator" || t=="prop") || !ind && (t=="list" || t=="meta"))
				continue;
			var p = this.auswahl[t], prefs = [];
			if (t == "generator") {
				q[t] = p;
				prefs = ["g" + this.parameters.prefixes[p]];
			} else {
				q[t] = p.slice(0); // auswahl[!generator] ist ein Array
				for (var i=0; i<p.length; i++)
					prefs.push(this.parameters.prefixes[p[i]]);
			}
			for (var i=0; i<prefs.length; i++)
				if (this.query[prefs[i]]) // false, null etc: parameterlose Queries
					for (var par in this.query[prefs[i]])
						q[prefs[i] + par] = this.query[prefs[i]][par]; // module prefix + parameter name
		}
		return q;
	},
	getRequests: function(qc, current, speclimit) {
/* get: queryContinue-Object (from result), current base object, how many set items for each query
return: Array(branch objects) */
		this.validateParams();
		if (!qc || Object.isEmpty(qc)) { // no querycontinue object yet, or nothing to continue
			if (!current && speclimit) { // when there are no base objects, we are at the beginning
				if (this.set.length) { // with a set
					var branches = []; // we may have to return many start bases
					for (var i=0; i<this.set.length; i+=speclimit) { // namely ceil(length/speclimit)
						branches.push({
							params: this.getParams(true, true), // so a full parameter set with everything
							base: Object.set({}, this.source, this.set.slice(i, i+speclimit)) // each with a different part of the set
						});
					}
					return branches;
				} else // only generators, list or meta info
					return [{ // we return only one
						params: this.getParams(true, true), // full parameter set
						base:{} // but nothing specific
					}];
			}
			return false; // a base object and no continues? We've reached the end
		}
		var ic = {}, // independent continues
			gc = {}, // generator continues
			pc = {}, // property continues
			// qc: query continue (an argument)
			g = this.auswahl.generator;
		for (var i in qc) { // every module may return some continue parameters
			if (g && i == g) { // if that module is our generator (as far as we have one)
				var pref = this.parameters.prefixes[g];
				for (var j in qc[i]) // we check for the continue parameters
					if (j.startsWith("g"+pref)) { // if they are generator continue parameters (they don't have to!)
						gc[j] = qc[i][j];
						delete qc[i][j]; // affects the result object!
					} // else if (!j.startsWith(pref)) console.log("mw.Api.Query.getRequests: unknown continue parameter '"+j+"' for the "+i+" module!");
			}
			if (this.parameters.types[qc[i]] == "prop") // so after generator continue parameters are filtered out, 
				Object.extend(pc, qc[i]); // there may be some properties to continue
			else
				Object.extend(ic, qc[i]); // or anything that doesn't belong to a generator pageset (i.e. lists)
		}
		if (current.next) { // if the current is part of a branch
			if (Object.isEmpty(pc)) // and when there are no properties to continue
				return false; // this branch ends
			current.params = Object.extend(this.getParams(true, false), pc); // else let's generate a parameter set with generator and property values, and property continue values
			return [current]; // and return it
		}
		if (!g || Object.isEmpty(gc)) { // else if we have no generator or no continue parameters for it
			if (Object.isEmpty(pc)) { // when there are also no property continue parameters
				if (Object.isEmpty(ic))
					return false; // Ende! qc war leer (toter Code, isEmpty(qc) wird oben schon behandelt)
				current.params = Object.extend(this.getParams(false, true), ic); // we will only have to continue with pageset-independent modules
				current.base = {}; // and for those there's no base
			} else {
				current.params = Object.extend(this.getParams(true, !Object.isEmpty(ic)), pc, ic); // or we will continue with properties (and others alongside, should they exist)
			}
			return [current]; // and go on with this branch
		}
		// if (g && gc && !current.next)
		current.next = { // create a new step for generator continue
			params: Object.extend(this.getParams(true, !Object.isEmpty(ic)), ic), // with a parameter set of generator and property values (and others along, should they exist and want to continue)
			base: this.source // base the new step
				? Object.set(gc, this.source, current.base[this.source]) // on the (continued) generator page set, together with current step's set, of course
				: gc // as far as one would exist
		};
		if (Object.isEmpty(pc)) { // when the current wants to continue with properties
			current.params = Object.extend(this.getParams(true, false), pc); // build a parameter set with generator and property values, and property continue values
			return [current, current.next]; // and return both
		} else
			return [current.next]; // or just return the new step
	},
	maximizeLimits: function() {
/* sets the limit of each query module to the value "max", where there isn't one already */
		function max(typ, m, gen) {
			var key = (gen || "") + this.parameters.prefixes[m];
			var params = this.query[key] || (this.query[key] = {}); // creates new params object if there is none
			if ("limit" in params) // not check for typeof params.limit != "undefined", to allow disabling
				return;
			if (typ == "prop")
				if (["info","categoryinfo"/*, "imageinfo"*/, "pageprops"].indexOf(props[i]) != -1 // imageinfo queries (image) revisions. Is max intended then?
					||	m == "revisions" // special case: can throw errors when used within specific queries
					&& (this.source == "revids" || this.auswahl.generator || this.set.length > 1) // would be /allowed/ when none of startid, endid, dirNewer, user, excludeuser, start and end are supplied - but it won't be inteded anyway
				)
					return;
			params.limit = "max";
		}
		var lists, props, gen;
		if (lists = this.auswahl.list)
			for (var i=0; i<lists.length; i++)
				max.call(this, "list", lists[i]);
		if (props = this.auswahl.prop)
			for (var i=0; i<props.length; i++)
				max.call(this, "prop", props[i]);
		if (gen = this.auswahl.generator)
			max.call(this, this.parameters.types[gen], gen, "g");
		return this; // chainable
	},
	toGenerator: function() {
		var a = this.auswahl, q;
		if (a.meta && a.meta.length)
			return false;
		if (a.generator && (a.prop || []).length + (a.list || []).length < 1) {
			q = new this.constructor({generator: a.generator});
			q.query = Object.clone(this.query, true);
		} else if (!a.generator && (a.prop || []).length + (a.list || []).length == 1) {
			var g = a.prop ? a.prop[0] : a.list[0];
			if (this.parameters.generators.indexOf(g) > -1) {
				q = new this.constructor({generator: g});
				q.query["g"+Object.keys(this.query)[0]] = Object.clone(Object.values(this.query)[0]);
			}
		}
		if (!q)
			return false;
		q.source = this.source;
		q.set = this.set.slice(0);
		q.features = Object.clone(this.features);
		return q;
	}
});