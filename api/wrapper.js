(function(){ if(typeof window.usg.MEDIAWIKISCRIPT != 'undefined') window.usg.MEDIAWIKISCRIPT.push("api"); else return;
var oldStartUp;
Object.defineProperty(window,"startUp", {
	get: function() {
		return function() {
			oldStartUp();
			localStartUp(mediaWiki, jQuery);
		};
	},
	set: function(n) {
		oldStartUp=n;
	},
	configurable: true,
	enumerable: true
});
window.localStartUp = function(mw, jq) {

/*
* assign in here to:
* 
* mw.Api
* mw.Api.serializeQuery
* mw.Api.Settings
* mw.Api.prototype
*                 .promise
*                 .stream
*                 .query
*                 .act
*                 .edit
* mw.Api.handleMaxlag
* mw.Api.Query
* mw.Api.Query.prototype
*                       .parameters
*                       .toString
*                        .validateParams
*                        .getQueryParams
*                       .getParams
*                       .getRequests
*                       .maximizeLimits
*                       .toGenerator
* mw.Api.Bot
* mw.Api.Bot.prototype
*                     .edit
*                     .replaceTemplate
*                     .wikitext.formatTemplate
*/

Object.defineProperty(mw, "Api", {writable:false});
Object.defineProperty(mw.Api, "prototype", {writable:false});
}})(); // end localstartup // end MEDIAWIKISCRIPT local function