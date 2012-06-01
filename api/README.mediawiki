This is my Api implementation for a MediaWiki Api.

It is more or less standalone, i.e. it does not need a Mediawiki environment to run.
It does not need jQuery or any RessourceLoader modules, it even should work without a global <code>mediawiki</code> object (Although it lives in the <code>mw</code> namespace).
Yet, is has its dependencies to my <code>Promise</code> implementation, to the native-object-extensions of <code>F.js</code> and even some to tools.js.

I currently use it with this [[wrapper.js|wrapper script]] in my userscripts, so that it overwrites the current "native" mw.Api object on a MediaWiki site.
Yet I plan to merge the two - I hope it works, I don't think jQuery's deferred will be enough for the task of my Query methods.