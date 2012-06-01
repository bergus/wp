mw.Api = function(url) {
	var that = this;
	var request_type = "local";
	if (!url) {
		if (mw.config.get('wgEnableAPI') === false)
			throw new Error("mw.Api: Lokale API ist deaktiviert");
		//url = /* mw.config.get('wgServer') + */ mw.config.get('wgScriptPath') + "/api" + mw.config.get('wgScriptExtension');
		url = mw.util.wikiScript('api');
	} else {
		if (url.indexOf(mw.config.get('wgServer'))==0 || url.charAt(0)=="/" && url.charAt(1)!="/")
			mw.log("mw.Api: He, '"+url+"' sieht nach lokaler URL aus");
		else //if (url.indexOf(location.protocol) != 0)
			request_type = "remote";
			
		if (url == "mw") url = "www.mediawiki.org/w/api.php";
		if (url.lastIndexOf("/") < url.indexOf(".")) url += "/api.php";
		if (url.indexOf("//")<0) url = "//"+url; // protocol-relative
	}
	this.settings = Object.create(this.constructor.Settings);
	this.getUrl = function() { return url; };
	this.request = function(query, onSuccess, onError, settings) {
/* get: Query-Parameter Object, Function success callback[, Function (Fatal)error callback][, Object overwrite default settings]
return: true, function to cancel/abort/stop ??? */
		settings = (Object(settings) === settings) ? Object.extendCreated(this.settings, settings) : this.settings;
		var timeout;
		query = Object.clone(query, true);
		if (settings.type == "remote" || request_type == "remote") { // kann nicht zu lokalem Request gezwungen werden
			var rmc = that.constructor.remoteCallbacks;
			if (!rmc)
				rmc = that.constructor.remoteCallbacks = [];
			rmc.push(onSuccess); 
			/* function(result) {
				// settings.callback.call(script, {type:"beforerunning"}, url, query);
				onSuccess(result);
				// settings.callback.call(script, {type:"afterrunning"}, url, query);
			}); */
			if (query.format)
				delete query.format; //funktioniert nur mit Objekten!!!
			var script = jBergi.html("script", {
				'type':"text/javascript",
				'src':url + "?"+settings.getRemoteUrl("window.mediaWiki.Api.remoteCallbacks["+(rmc.length-1)+"]")+"&" + that.constructor.serializeQuery(query)
			});
			script.onreadystatechange = script.onload = function scriptstate(e) {
				window.clearTimeout(timeout);
				settings.callback.call(script, e, url, query);
				if (document.head.contains(script))
					document.head.removeChild(script); // remove it to not pollute the head element
			}
			script.onerror = onError; // Firefox seems to be capable of this
			timeout = window.setTimeout(function(){
				script.onload(); // remove it and call callback (as not intended)
				onError.call(script, 509, "timeout or undetectable error"); // network connect timeout error: kein echter 408
			}, settings.timeout);
			document.head.appendChild(script);
			return true;
		}
		var get = "",
			format = settings.format.toLowerCase(),
			parse;
		if (parse = settings.accept[format]) {
			query.format = format;
		} else {
			query.format = "json";
			parse = settings.accept["json"]
		}
		if (settings.get > 0) {
			get = ["action="+encodeURIComponent(query.action)]; // muss String sein
			if (query.action=="query" && (settings.get == 2 || settings.get > 3)) {
				get.push(that.constructor.serializeQuery({prop:query.prop, list:query.list, meta:query.meta}));
				delete query.prop;
				delete query.list;
				delete query.meta;
			}
			delete query.action;
			if (settings.get > 2) {
				get.push("format="+encodeURIComponent(format));
				delete query.format;
			}
			get = "?"+get.join("&");
		}
		var xhr = new XMLHttpRequest(); // for older Browsers please see legacy.js
//		xhr.addEventListener("progress", function updateProgress() {}, false);
//		xhr.addEventListener("load", function transferComplete() {}, false);
//		xhr.addEventListener("error", function transferFailed() {}, false);
//		xhr.addEventListener("abort", function transferCanceled() {}, false);
		xhr.onreadystatechange = function(e) {
			settings.callback.call(xhr, e||{type:"eventless_readystatechange"}, url+get, query);
			if (xhr.readyState != 4) return;
			if (xhr.status < 200 || xhr.status > 203) { // 200: OK, 201: Created, 202: Accepted, 203: Non-Authoritative Information; eher unüblich (unmöglich?), aber keine Fehler; jQuery akzeptiert 304, 1223 und 0
				if (typeof onError == "function")
					onError.call(xhr, xhr.status, xhr.statusText);
				else
					throw new Error("mw.Api.request: XMLHttpRequest-Error "+xhr.status+" ("+xhr.statustext+")");
			} else {
				onSuccess.call(xhr, parse(xhr) );
			}
		}
		query = that.constructor.serializeQuery(query);
		var m = settings.method.toUpperCase() == 'GET' && query.length < this.settings.maxURIlength;
		xhr.open( m ? "GET" : "POST", url + (m ? (get?get+"&":"?")+query : get), settings.asynchronous);
		xhr.setRequestHeader("Content-Type", settings.contentType);
		xhr.send( m ? null : query);
	};
};