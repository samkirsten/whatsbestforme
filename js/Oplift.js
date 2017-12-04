 /*******************************************************************/
/*   use Marionette.Application to namespace to avoid creating an empty object
 /*   however it means you have to be careful to create it before all the other objects since you can't check for existence on each file
 /*******************************************************************/

 console.log(Backbone.LocalStorage);

var BestForMe = Backbone.Marionette.Application.extend({

  // store in a appData object all the data that needs to be shared with generic modules [to reduce init boilerplate code]
  // it's only 'leaf views' (with no child views) which get passed only the data they need
  // otherwise the init code got unmanageable
  // when you had to pass to node views data they do not necessarily need themselves just so that they can pass it on to their child views who do need it
  // and work up the tree to change the init code of all the parents when a leaf view somewhere needed access to another bit of data
  appData: {

    // API Base URL, used to test whether we're on dev/staging/prod
    apiBaseUrl: null,

    // API data endpoints
    endpoints: {
      ee: null,
      three: null,
      vodafone: null,
      o2: null,
      ofcom: null
    },

    // data from server, the dataManager is responsible for populating it
    // this data object just contains empty keys to put the data on
    // the data managers is responsible to put whatever data it needs on these keys
    // it can be directly a backbone model or collection, or a another objects with keys
    data: {
      // if the data is 'core', i.e. fetched directly by the app data manager on launch then the app data manager create the data structures
      user: null,
      dash: null,
      // if the data belongs to a module, then the module data manager creates the data structures and manages them
      article: null,
      pathways: null,
      news: null,
      statistics: null,
      banners: null,
      dock: null,
      notifications: null,
      acknowledgements: null,
      footer: null,
      search: {
        collection: null,
        query: null
      }
    },

    // stores whether specific features of the application are enabled
    // the values are controlled by ENV variables in the build
    // or overriden later to false if no data ifs found
    features: {
      statistics: false,
      dock: false,
      dash: false,
      banner: false
    },

    // tells which bestForMe modules are enabled in this build
    modules: {
      // engage will enable: articles + news + notifications, it's not possible to get just one of these without the others
      engage: false,
      pathways: false,
      bestforme: false
    },

    // special mode to bypass the login and get data locally, no server calls at all, after initial load, the webapp runs by itself
    localMode: false,

    // give all modules access to token, for validity quick check
    token: null,

    // once auth has acquired a token, all subsequent requests auth themselves with Bearer <token>
    tokenBearerHeader: null,

    // if true, turns on logging for debugging
    debug: false,

    // title of the application
    title: null,

    // lookup table of error messages by error codes
    // shared between the error screen and the error handler
    // !!! only used by the standalone error screen, does not affect custom on-screen error notices on normal content screens
    errorMessage: {
      0 : 'The server could not be reached. Please wait 30 seconds and try to reload the page.',
      500 : 'The server could not be reached. Please wait 30 seconds and try to reload the page.',
      503 : 'The server could not be reached. Please wait 30 seconds and try to reload the page.',
      504 : 'The server could not be reached. Please wait 30 seconds and try to reload the page.',
      404 : 'The page you requested could not be found.',
      400 : 'There is a problem with this version of the app. Please contact technical support.'
    },

    // webapp root homepage, in this case home
    // MM: this could possibly be set in config, but hardcode for now
    rootHomePage: 'home'
  },

  // store in authData object all the data that need to be shared with auth code (auth controller + login screen) [to reduce init boilerplate code]
  authData: {

    // Webapp client credentials to communicate with server
    clientCredentials: null,

    // login model
    login: null,

    // token endpoint
    tokenEndpoint: null,

    // user endpoint
    userEndpoint: null,

    // password endpoint (to change the password)
    passwordEndpoint: null,

    // to store the password reset credentials passed by url
    passwordReset: null
  },

  // top level controller managing User login/token
  auth: null,

  // top level controller responsible for getting the data from server
  dataManager: null,

  // app top level controller and router
  routerController: null,
  router: null,

  // Backbone auth radio channel
  // required for messaging between modules/views who don't have a direct reference to auth, so can't directly listen to events on it
  authChannel: null,

  // Backbone data radio channel
  // Data Manager uses it to broadcast a message that all data (tags, categories, quizzes, cases) have been retrieved, or there was an error
  dataChannel: null,

  // Backbone router radio channel
  // this is used by views to trigger navigation to a different route
  routerChannel: null,

  // when the user reloads on a bookmarked view, we need to load the data first
  // then redirect to the view once the data is loaded
  redirectTo: {
    // path will be used if history pushstate is enabled
    pathname: null,
    // hash will be use for old style # internal links
    hash: null
  },


  /* --- Initialisation code: init modules and pass them the data they need  --- */

  initialize: function(config) {

    // enable or disable logging for the application, uses string instead of bool due to ENV variables only being strings
    if (config.debug === 'false') {
      console.log = function(){};
    }

    console.log('BestForMe.INIT href: '+window.location.href+' pathname: '+window.location.pathname+' hash: '+window.location.hash);
    // init AppData object
    this.initAppData(config);

    // radio channel to tell when data has been loaded from server
    this.dataChannel = Backbone.Radio.channel('data');

    // radio channel used by views to trigger navigation to a different route
    this.routerChannel = Backbone.Radio.channel('router');

    // views send an event telling main app to navigate to another view
    this.listenTo(this.routerChannel, 'navigate:to:page', this.navigateToPage);

    // router tells the main app a route has not been blocked, so it's OK to clear the redirect
    this.listenTo(this.routerChannel, 'route:executed', this.onRouteExecuted);

    // top level controller responsible for getting the data from server
    this.dataManager = new BestForMe.DataManager({
      appData: this.appData
    });

    // app top level controller and router
    // needs both authData for login screen
    // and appData for all other screens
    this.routerController = new BestForMe.RouterController({
      authData: this.authData,
      appData: this.appData
    });

    this.router = new BestForMe.Router({
      appData: this.appData,
      controller: this.routerController
    });
  },

  // init AppData object
  initAppData: function(config) {

    

    // special mode to bypass the login and get data locally, no server calls at all, after initial load, the webapp runs by itself
    if (config.features.localMode === 'true') {
      this.appData.localMode = true;
      // in local mode, data is local json files
      this.appData.apiBaseUrl = '/data';
    }
    else {
      this.appData.localMode = false;
      // API Base URL, used to test whether we're on dev/staging/prod
      this.appData.apiBaseUrl = config.baseUrl;
    }

    // set data endpoints from config on main app object
    // MM  TODO on main bestForMe: we should match the structure endpoint.dataname in config too, and only init the endpoint if the module is enabled in the build
    this.appData.endpoints.ee = config.eeEndpoint;
    this.appData.endpoints.three = config.threeEndpoint;
    this.appData.endpoints.vodafone = config.vodafoneEndpoint;
    this.appData.endpoints.o2 = config.o2Endpoint;
    this.appData.endpoints.ofcom = config.ofcomEndpoint;
    this.appData.title = config.title;
    this.appData.debug = config.debug;

    // tells which shared/homepage bestForMe features are enabled in this build
    if (config.features.footer === 'true') {
      this.appData.features.footer = true;
    }
    else {
      this.appData.features.footer = false;
    }
      this.appData.modules.bestforme = true;
  },

  /* --- Start code: start app once all submodules have been created  --- */

  onStart: function() {

    console.log('BestForMe.START href: '+window.location.href+' pathname: '+window.location.pathname+' hash: '+window.location.hash);

    console.log('LOCALMODE: '+this.appData.localMode);

    // try to detect if the user is trying to load a specific page
    // the server will serve bestForMe root but we try to redirect to the desired page after the data has loaded
    // MM: I think we should detect on start, not init, but not 100% sure
    this.detectUniversalLinks();
    this.detectUrl();

    // !!! start router history BEFORE starting the authentification event chain, otherwise it's too late for the login screen to show up!!!
    // MM: {pushState: true} enables url without # but the server needs to be able to cope with them and serve the app
    // if the server served the base bestForMe then I think we'd be able to pick up the location and toute to it on client side
    Backbone.history.start({pushState: true});
    //Backbone.history.start();

    // bypass login in local mode 
    if (this.appData.localMode) {
      this.bypassAuth();
    }
    
  },

  // try to detect if the user is trying to load a specific page
  // the server will serve bestForMe root but we try to redirect to the desired page after the data has loaded
  detectUrl: function() {
    console.log('BestForMe.detectUrl href: '+window.location.href+' pathname: '+window.location.pathname+' hash: '+window.location.hash);
    // path will be used if history pushstate is enabled
    // do not store is pathname is just root '/'
    // do no store if login screen, otherwise you stay stuck on it after successful login
    if (window.location.pathname && window.location.pathname !== '/' && !window.location.pathname.match(/login/)) {
      this.redirectTo.pathname = window.location.pathname;
    }
    // hash will be use for old style  internal links
    if (window.location.hash && !window.location.hash.match(/login/)) {
      this.redirectTo.hash = window.location.hash;
    }
    console.log(JSON.stringify(this.redirectTo));
  },

  findGetParameter: function(parameterName) {
    var result = null,
      tmp = [];
    location.search
      .substr(1)
      .split("&")
      .forEach(function (item) {
        tmp = item.split("=");
        if (tmp[0] === parameterName) result = decodeURIComponent(tmp[1]);
      });
    return result;
  },

  /* --- Code waiting for messages from authentification module  --- */

  // fired by Authentification module if no login was found in local storage
  // so the root app tells the router to display the login screen
  onLoginRequired: function() {

    console.log('App.onLoginRequired');

    // make router navigate to login screen, unless the user is trying to reset their forgotten password
    if (( this.redirectTo.pathname && this.redirectTo.pathname.match(/reset-password/)) || (this.redirectTo.hash && this.redirectTo.hash.match(/reset-password/))) {
      this.redirectToPage(false);
    }
    else {
      this.router.navigate("login", {trigger: true});
    }
  },

  // fired by Authentification module if the token had expired before attempting a XHR request
  // this can happen on any view, so the app redirects to the login screen
  onLoginInvalid: function(errorMessage) {

    console.log('App.onLoginInvalid: '+errorMessage);

    // save what view we were on
    this.detectUrl();

    // make router navigate to login screen
    this.router.navigate("login", {trigger: true});

  },

  // sent by profile view to cause a log out
  onLogOut: function() {

    console.log('App.onLogOut');

    // MM: the main app is the only one to react to the logout event
    // because we need to make sure clearing the login and token from local storage (auth)
    // happens before the data objects are reset (data manager)
    // so the main app controls the order, instead of each module catching the event in unpredictable order
    this.auth.onLogOut();
    this.dataManager.clearData();

    // make router navigate to login screen since we were on the profile screen
    this.router.navigate("login", {trigger: true});

  },

  // fired by Authentification module when valid token has been received for initial authentification on app launch
  onAuthComplete: function() {

    console.log('App.onAuthComplete: '+JSON.stringify(this.appData.tokenBearerHeader));

    //console.log('App.onAuthComplete tokenBearerHeader: '+JSON.stringify(tokenBearerHeader));
    // Authentific`tion is complete once the 'Bearer token' Header is ready to use to fetch the rest of the data
    // fetch the data asynchronously
    this.dataManager.fetchData();

    // show a temp screen with the BestForMe header but a spinning wheel in the main content view
    // this view show in the grey area time when the login is complete but the core data has not been fetched yet
    // despite the 'isRendered' check inside AppLayout, you need to force a render when coming to the main screen from the login screen for the first time
    // this separate method is the ONLY way I managed to get it to work
    this.routerController.forceInitialRender();
    this.router.navigate('loading', {trigger: true});
  },

  // bypass auth in local mode
  bypassAuth: function() {

    console.log('App.bypassAuth');

    // fetch the data locally
    this.dataManager.fetchData();

    // show a temp screen with the BestForMe header but a spinning wheel in the main content view
    // this view show in the grey area time when the login is complete but the core data has not been fetched yet
    // despite the 'isRendered' check inside AppLayout, you need to force a render when coming to the main screen from the login screen for the first time
    // this separate method is the ONLY way I managed to get it to work
    // with local data it should harldly have time to show at all
    // but we're doing things properly in case the json file is not found or can't be read
    this.routerController.forceInitialRender();
    this.router.navigate('loading', {trigger: true});
  },

  // fired by Authentification module when valid token has been received after it had expired and a view/module requested an update
  onTokenUpdated: function() {

    console.log('App.onTokenUpdated: '+JSON.stringify(this.appData.tokenBearerHeader));

    // if we diverted to the login screen, redirect to the view we were on when the token updated was requested
    // false = if redirect url is empty, do not redirect to home by default
    // this is the case when the token was refreshed behind the scenes and we stayed on the view
    this.redirectToPage(false);
  },


  /* --- Code waiting for messages from data manager module  --- */

  // data fetch error is sent by data manager when there was a XHR error fetching data
  onDataFetchError: function(formattedError) {

    console.log('App.onDataFetchError: '+JSON.stringify(formattedError));

    // redirect to login screen
    if (formattedError.action === 'login') {
      this.router.navigate('login', {trigger: true});
    }
    // redirect to error screen
    else if (formattedError.action === 'error') {
      var route = 'error/'+formattedError.errorCode;
      this.router.navigate(route, {trigger: true});
    }
    // for core data only, it's not enough to just display the message if it's a server down error
    // we want to stop being stuck on the loading screen as soon as we know there is a server error
    else if (formattedError.action === 'message' && (formattedError.errorCode === 500 || formattedError.errorCode === 503 || formattedError.errorCode === 504 || formattedError.errorCode === 0) ) {
      this.routerChannel.trigger('server:down');
    }
  },

  // data fetched is sent by Data manager when all data have been fetched, so the app can route to the main screen
  onDataFetched: function() {

    console.log('App.onDataFetched');

    // tell router that core data has been fetched, so it stops blocking navigation to content views
    this.router.onDataFetched();

    // MM: need to wait for all core data to be fetched  before showing the home screen
    // despite the 'isRendered' check inside AppLayout, you need to force a render when coming to the main screen from the login screen for the first time
    // this separate method is the ONLY way I managed to get it to work
    this.routerController.forceInitialRender();

    // redirect to a desired page after we temporarily had to go to the login or loading screen
    // true = if redirect url is empty, redirect to home by default
    this.redirectToPage(true);

  },

  // data manager tells if optional features have missing data (even though enabled in ENV)
  // in which case we disable them at run time
  onMissingData: function (dataName) {
    console.log('App.onHideMissingData: '+dataName);

    if (dataName === 'statistics') {
      this.appData.features.statistics = false;
    }
    else if (dataName === 'dock') {
      this.appData.features.dock = false;
    }
  },

/* --- Redirect and navigate to views  --- */

  // clear the redirect once we have navigated to it
  clearRedirect: function() {
    console.log('BestForMe.clearRedirect: '+JSON.stringify(this.redirectTo));
    this.redirectTo.pathname = null;
    this.redirectTo.hash = null;
  },

  // router tells the main app a route has not been blocked, so it's OK to clear the redirect
  onRouteExecuted: function(routeMatch) {

    console.log('App.onRouteExecuted: '+routeMatch+', redirect: '+JSON.stringify(this.redirectTo));

    // clear the redirect now if the redirect route has been executed
    // MM: test for auth.initialAuthCompleted: do not clear if we're about to be temporarily redirected tor he login screen
    if (this.auth.initialAuthCompleted && ((this.redirectTo.pathname && this.redirectTo.pathname.match(routeMatch)) || (this.redirectTo.hash && this.redirectTo.hash.match(routeMatch)))) {
      console.log('CLEAR REDIRECT MATCH');
      this.clearRedirect();
    }
  },


  // redirect to a desired page after we temporarily had to go to the login or loading screen
  // defaultToHome:
  //   - true -> if redirect url is empty, redirect to home by default
  //   - false ->  if redirect url is empty, do nothing, stay on current view
  redirectToPage: function(defaultToHome) {

    // if the user originally tried to load a specific page and it exists, redirect to it
    if (this.redirectTo.pathname) {
      console.log('App.redirectToPage REDIRECT TO PATHNAME: '+this.redirectTo.pathname);
      this.router.navigate(this.redirectTo.pathname, {trigger: true});
    }
    else if (this.redirectTo.hash) {
      console.log('App.redirectToPage REDIRECT TO HASH: '+this.redirectTo.hash);
      this.router.navigate(this.redirectTo.hash, {trigger: true});
    }
    // otherwise show the home page by default
    else if (defaultToHome) {
      this.router.navigate(this.appData.rootHomePage, {trigger: true});
    }
    // otherwise do nothing, stay on current view
  },

  // views send an event telling main app to navigate to another view
  // - routeBase: mandatory
  // - routeParam: optional, such as categoryId for cases by category, caseId for case detail, quizId for quiz detail
  navigateToPage: function(routeBase, routeParam1, routePart2, routeParam2) {
    console.log('App.navigateToPage: '+routeBase+' '+routeParam1+' '+routeParam2);

    var  fullRoute = routeBase;

    if (routeParam1) {
      // add / separator if not already trailing end of base route
      if (fullRoute.slice(-1) !== '/') {
        fullRoute += '/';
      }
      fullRoute += routeParam1;
    }
    if (routePart2) {
      fullRoute += '/'+routePart2;
    }
    if (routeParam2) {
      fullRoute += '/'+routeParam2;
    }

    this.router.navigate(fullRoute, {trigger: true});
  },

  // password reset succes: clear reset-password redirect (otherwise we'll go back to it after login) and show login screen
  onPasswordResetClearRedirect: function() {
    this.clearRedirect();
    this.router.navigate('login', {trigger: true});
  }

});

;// MM: Custom event IE polyfill
// Required for local store manager (plain JS) to communicate with the backbone app
// TODO: test that it does not interfere with backbone in-built events in IE
// if it does, I'll have to rewrite the local store manager as a backbone object
// but I'd rather avoid to, because of the weird way they put properties on the instances

(function () {

  if ( typeof window.CustomEvent === "function" ) return false;

  function CustomEvent ( event, params ) {
    params = params || { bubbles: false, cancelable: false, detail: undefined };
    var evt = document.createEvent( 'CustomEvent' );
    evt.initCustomEvent( event, params.bubbles, params.cancelable, params.detail );
    return evt;
   }

  CustomEvent.prototype = window.Event.prototype;

  window.CustomEvent = CustomEvent;
})();;// MM: Adapted from Ebenezer Monney, without requireJS
// http://www.ebenmonney.com/blog/how-to-implement-remember-me-functionality-using-token-based-authentication-and-localstorage-in-a-web-application
// http://www.ebenmonney.com/Media/Default/Code/local-store-manager.js
// Email: i@ebenmonney.com

BestForMe.LocalStoreManager = (function () {
    
  // MM: this is the constructor
  function LocalStoreManager() {

    var _this = this;
    this.syncKeys = [];
    this.reservedKeys = ['sync_keys', 'addToSyncKeys', 'removeFromSyncKeys',
      'getSessionStorage', 'setSessionStorage', 'addToSessionStorage', 'removeFromSessionStorage', 'clearAllSessionsStorage', 'raiseDBEvent'];
    this.localStorageSupported = false;

    this.sessionStorageTransferHandler = function (event) {
      if (!event.newValue) {
        return;
      }               
      if (event.key == 'getSessionStorage') {
        if (sessionStorage.length) {
          if (_this.localStorageSupported) {
            localStorage.setItem('setSessionStorage', JSON.stringify(sessionStorage));
            localStorage.removeItem('setSessionStorage');
          } 
        }
      }
      else if (event.key == 'setSessionStorage') {
        _this.setSessionStorageHelper(event.newValue);
      }
      else if (event.key == 'addToSessionStorage') {
        var data = JSON.parse(event.newValue);
        _this.addToSessionStorageHelper(data["data"], data["key"]);
      }
      else if (event.key == 'removeFromSessionStorage') {
        _this.removeFromSessionStorageHelper(event.newValue);
      }
      else if (event.key == 'clearAllSessionsStorage' && sessionStorage.length) {
        _this.clearInstanceSessionStorage();
      }
      else if (event.key == 'addToSyncKeys') {
        _this.addToSyncKeysHelper(event.newValue);
      }
      else if (event.key == 'removeFromSyncKeys') {
        _this.removeFromSyncKeysHelper(event.newValue);
      }
    };
  }

  // check whether local storage is supported (main issue is Safari private browsing)
  LocalStoreManager.prototype.isLocalStorageSupported = function () { 
    try {
      localStorage.setItem('test', 1);
      localStorage.removeItem('test');
      return true;
    } catch(e) {
      return false;
    }
  };

  //Todo: Implement EventListeners for the various event operations and a SessionStorageEvent for specific data keys
  LocalStoreManager.prototype.initialiseStorageSyncListener = function () {
    console.log('LocalStoreManager.initialiseStorageSyncListener: '+LocalStoreManager.syncListenerInitialised);
    if (LocalStoreManager.syncListenerInitialised == true) {
      return;
    }     
    LocalStoreManager.syncListenerInitialised = true;
    this.localStorageSupported = this.isLocalStorageSupported();
    console.log('LOCAL STORAGE SUPPORTED ? '+this.localStorageSupported);
    window.addEventListener("storage", this.sessionStorageTransferHandler, false);
    this.syncSessionStorage();
  };

  LocalStoreManager.prototype.deinitialiseStorageSyncListener = function () {
    window.removeEventListener("storage", this.sessionStorageTransferHandler, false);
    LocalStoreManager.syncListenerInitialised = false;
  };

  // MM: update current tab session storage with synced data from other tab
  LocalStoreManager.prototype.setSessionStorageHelper = function (newValue) {
    if (!this.syncKeys.length) {
      this.loadSyncKeys(); 
    } 
    var data = JSON.parse(newValue);
    var updatedKeys = [];
    for (var key in data) {
      if (this.syncKeysContains(key)) {
        if (this.localStorageSupported) {
          sessionStorage.setItem(key, data[key]);
        }
        updatedKeys.push(key);
      }                   
    }
    // MM: notify the backbone app that the session storage has been set
    // session storage does not trigger 'storage' events itself on the tab that updated the session storage, contrary to local storage
    // (there would be a storage event on for example an iframe sharing the session storage though)
    // so in the tab that retrieves synced session storage, we need to tell the backbone app once session data has synced
    var e = new CustomEvent('sessionStorageSet',
      { 'detail': updatedKeys }
    );
    window.dispatchEvent(e);
  };

  LocalStoreManager.prototype.syncSessionStorage = function () {
    if (this.localStorageSupported) {
      localStorage.setItem('getSessionStorage', '_dummy');
      localStorage.removeItem('getSessionStorage');
    }
  };

  LocalStoreManager.prototype.clearAllStorage = function () {
    this.clearAllSessionsStorage();
    this.clearLocalStorage();
  };
        
  LocalStoreManager.prototype.clearAllSessionsStorage = function () {
    this.clearInstanceSessionStorage();
    if (this.localStorageSupported) {
      localStorage.removeItem(LocalStoreManager.DBKEY_SYNC_KEYS);
      localStorage.setItem('clearAllSessionsStorage', '_dummy');
      localStorage.removeItem('clearAllSessionsStorage');
    }
  };

  LocalStoreManager.prototype.clearInstanceSessionStorage = function () {
    if (this.localStorageSupported) {
      sessionStorage.clear();
    }
    this.syncKeys = [];
  };

  LocalStoreManager.prototype.clearLocalStorage = function () {
    if (this.localStorageSupported) {
      localStorage.clear();
    }
  };

  LocalStoreManager.prototype.addToSessionStorage = function (data, key) {
    console.log('localStoreManager.addToSessionStorage: '+key);
    this.addToSessionStorageHelper(data, key);
    this.addToSyncKeysBackup(key);
    if (this.localStorageSupported) {
      localStorage.setItem('addToSessionStorage', JSON.stringify({ key: key, data: data }));
      localStorage.removeItem('addToSessionStorage');
    }
  };

  LocalStoreManager.prototype.addToSessionStorageHelper = function (data, key) {
    this.addToSyncKeysHelper(key);
    if (this.localStorageSupported) {
      sessionStorage.setItem(key, data);
    }
  };

  LocalStoreManager.prototype.removeFromSessionStorage = function (keyToRemove) {
    this.removeFromSessionStorageHelper(keyToRemove);
    this.removeFromSyncKeysBackup(keyToRemove);
    if (this.localStorageSupported) {
      localStorage.setItem('removeFromSessionStorage', keyToRemove);
      localStorage.removeItem('removeFromSessionStorage');
    }
  };

  LocalStoreManager.prototype.removeFromSessionStorageHelper = function (keyToRemove) {
    if (this.localStorageSupported) {
      sessionStorage.removeItem(keyToRemove);
    }
    this.removeFromSyncKeysHelper(keyToRemove);
  };

  LocalStoreManager.prototype.testForInvalidKeys = function (key) {
    if (!key) {
      throw new Error("key cannot be empty");
    }
    if (this.reservedKeys.some(function (x) { return x == key; })) {
      throw new Error("The storage key \"" + key + "\" is reserved and cannot be used. Please use a different key");
    }              
  };

  LocalStoreManager.prototype.syncKeysContains = function (key) {
    return this.syncKeys.some(function (x) { return x == key; });
  };

  LocalStoreManager.prototype.loadSyncKeys = function () {
    if (this.syncKeys.length) {
      return;
    }               
    this.syncKeys = this.getSyncKeysFromStorage();
  };

  LocalStoreManager.prototype.getSyncKeysFromStorage = function (defaultValue) {
    if (defaultValue === void 0) { 
      defaultValue = []; 
    }
    var data = localStorage.getItem(LocalStoreManager.DBKEY_SYNC_KEYS);
    if (data == null) {
      return defaultValue;
    }
    else {
      return JSON.parse(data);
    }            
  };

  LocalStoreManager.prototype.addToSyncKeys = function (key) {
    this.addToSyncKeysHelper(key);
    this.addToSyncKeysBackup(key);
    if (this.localStorageSupported) {
      localStorage.setItem('addToSyncKeys', key);
      localStorage.removeItem('addToSyncKeys');
    }
  };

  LocalStoreManager.prototype.addToSyncKeysBackup = function (key) {
    var storedSyncKeys = this.getSyncKeysFromStorage();
    if (!storedSyncKeys.some(function (x) { return x == key; })) {
      storedSyncKeys.push(key);
      if (this.localStorageSupported) {
        localStorage.setItem(LocalStoreManager.DBKEY_SYNC_KEYS, JSON.stringify(storedSyncKeys));
      }
    }
  };

  LocalStoreManager.prototype.removeFromSyncKeysBackup = function (key) {
    var storedSyncKeys = this.getSyncKeysFromStorage();
    var index = storedSyncKeys.indexOf(key);
    if (index > -1) {
      storedSyncKeys.splice(index, 1);
      if (this.localStorageSupported) {
        localStorage.setItem(LocalStoreManager.DBKEY_SYNC_KEYS, JSON.stringify(storedSyncKeys));
      }
    }
  };
        
  LocalStoreManager.prototype.addToSyncKeysHelper = function (key) {
    if (!this.syncKeysContains(key)) {
      this.syncKeys.push(key);
    }            
  };

  LocalStoreManager.prototype.removeFromSyncKeys = function (key) {
    this.removeFromSyncKeysHelper(key);
    this.removeFromSyncKeysBackup(key);
    if (this.localStorageSupported) {
      localStorage.setItem('removeFromSyncKeys', key);
      localStorage.removeItem('removeFromSyncKeys');
    }
  };

  LocalStoreManager.prototype.removeFromSyncKeysHelper = function (key) {
    var index = this.syncKeys.indexOf(key);
    if (index > -1) {
      this.syncKeys.splice(index, 1);
    }
  };

  LocalStoreManager.prototype.saveSessionData = function (data, key) {
    if (key === void 0) { 
      key = LocalStoreManager.DBKEY_USER_DATA; 
    }
    this.testForInvalidKeys(key);
    this.removeFromSyncKeys(key);
    if (this.localStorageSupported) {
      localStorage.removeItem(key);
      sessionStorage.setItem(key, data);
    }
  };

  LocalStoreManager.prototype.saveSyncedSessionData = function (data, key) {
    if (key === void 0) { 
      key = LocalStoreManager.DBKEY_USER_DATA; 
    }
    this.testForInvalidKeys(key);
    if (this.localStorageSupported) {
      localStorage.removeItem(key);
    }
    this.addToSessionStorage(data, key);
  };

  LocalStoreManager.prototype.savePermanentData = function (data, key) {
    console.log('localStoreManager.savePermanentData: '+key);
    if (key === void 0) { 
      key = LocalStoreManager.DBKEY_USER_DATA; 
    }
    this.testForInvalidKeys(key);
    this.removeFromSessionStorage(key);
    if (this.localStorageSupported) {
      localStorage.setItem(key, data);
    }
  };


  LocalStoreManager.prototype.getData = function (key) {
    if (key === void 0) { 
      key = LocalStoreManager.DBKEY_USER_DATA; 
    }
    this.testForInvalidKeys(key);
    var data = null;
    if (this.localStorageSupported) {
      data = sessionStorage.getItem(key);
      console.log('LocalStoreManager.getData TRY SESSION STORAGE'+key);
      console.log(data);
      if (data == null) {
        data = localStorage.getItem(key);
        console.log('LocalStoreManager.getData TRY LOCAL STORAGE'+key);
        console.log(data); 
      } 
    }  
    return data;
  };

  LocalStoreManager.prototype.getDataObject = function (key) {
    if (key === void 0) { 
      key = LocalStoreManager.DBKEY_USER_DATA; 
    }
    var data = this.getData(key);
    console.log(data);
    if (data != null) {
      return JSON.parse(data);
    }      
    else {
      return null;
    }             
  };

  LocalStoreManager.prototype.deleteData = function (key) {
    if (key === void 0) { 
      key = LocalStoreManager.DBKEY_USER_DATA; 
    }
    this.testForInvalidKeys(key);
    this.removeFromSessionStorage(key);
    if (this.localStorageSupported) {
      localStorage.removeItem(key);
    }
  };

  // MM: what we return is the constructor
  return LocalStoreManager;

}());

// MM: these go on instance._proto_.constructor, but not in the instance itself
// no clue what it's for
BestForMe.LocalStoreManager.syncListenerInitialised = false;
//BestForMe.LocalStoreManager.localStorageSupported = false;
BestForMe.LocalStoreManager.DBKEY_USER_DATA = "user_data";
BestForMe.LocalStoreManager.DBKEY_SYNC_KEYS = "sync_keys";

;// https://tc39.github.io/ecma262/#sec-array.prototype.includes
if (!Array.prototype.includes) {
  Object.defineProperty(Array.prototype, 'includes', {
    value: function(searchElement, fromIndex) {

      // 1. Let O be ? ToObject(this value).
      if (this == null) {
        throw new TypeError('"this" is null or not defined');
      }

      var o = Object(this);

      // 2. Let len be ? ToLength(? Get(O, "length")).
      var len = o.length >>> 0;

      // 3. If len is 0, return false.
      if (len === 0) {
        return false;
      }

      // 4. Let n be ? ToInteger(fromIndex).
      //    (If fromIndex is undefined, this step produces the value 0.)
      var n = fromIndex | 0;

      // 5. If n ≥ 0, then
      //  a. Let k be n.
      // 6. Else n < 0,
      //  a. Let k be len + n.
      //  b. If k < 0, let k be 0.
      var k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);

      function sameValueZero(x, y) {
        return x === y || (typeof x === 'number' && typeof y === 'number' && isNaN(x) && isNaN(y));
      }

      // 7. Repeat, while k < len
      while (k < len) {
        // a. Let elementK be the result of ? Get(O, ! ToString(k)).
        // b. If SameValueZero(searchElement, elementK) is true, return true.
        // c. Increase k by 1.
        if (sameValueZero(o[k], searchElement)) {
          return true;
        }
        k++;
      }

      // 8. Return false
      return false;
    }
  });
};/*************************************************************/
/* Error handler mixin 
/* to avoid repeating code in business logic modules because Marionette behaviors only share code snippets between views
/*
/* !!! the module or view using this mixin must have app Data defined on it!
/*
/* MM: due to limitation of the backbone router, it is not possible to pass complex parameters such as the error message
/* However it is possible to pass a short route param such as the error code
/* so we put on main appData a lookup table of error messages by error codes, shared between the error screen and the error handler
/* !!! only used by the standalone error screen, does not affect custom on-screen error notices on normal content screens looked up based on error code
/* not ideal but still better that overriding the backbone router navigate core code to make it able to handle custom params, which may stop working if we update backbone
/*************************************************************/

BestForMe.ErrorHandlerMixin = {

  // handle error following XHR request
  // response = response from the server contaning error code
  // options = backbone data about original xhr request that failed
  // defaultAction = true -> tell the error handler to proces the action i the most common way, most views will want that
  //                 false -> tell the error handler not to process the action itself, for complex modules who need to process the error in a custom way (auth module mostly)
  handleError: function(response, options, defaultAction) {

    console.log('handleError RESPONSE');
    console.log(response);
    if (options) {
      console.log('handleError OPTIONS');
      console.log(options);
    }

    // object containing error parameters
    var formattedError = {
      // error code: 0 = unknown error
      errorCode: 0,
      // user friendly error message to display
      errorMessage: '',
      // action = what to do depending on the error type:
      // - 'login': redirect to login screen with a message
      // - 'error': redirect to error screen with a message
      // - 'message': stay on current screen and display error message
      // - 'silent': stay on current screen and don't notify the user
      action: null
    };

    // find error code if specified, otherwise it defaults to 0
    if (response.status) {
      formattedError.errorCode = response.status;
    }

    // the action to take depends on when the error happened
    // if the error happened before successful login (either wrong username/PW or server down so login could not be checked at all)
    // then we should redirect to login screen with error message telling what happened
    // if the error happened after the user logged in successfully 
    // then we should redirect to an error screen explaining the error without asking them to log in again
    // for error that do not indicate a fundamental problem with server (no matching case) then stay on current screen with message

    // --- First are the errors which only depend on the status code, the original request is not really relevant to the error message ---
    // -- 200 = success - handle the case of backbone firing an error callback by mistake instead of firing a success callback
    if (formattedError.errorCode === 200) {

      formattedError.action = 'silent';
      formattedError.errorMessage += 'Success.';   

    }
    // -- server error = error 500, 503, 504, or formattedError.errorCode = 0 id internet is disconnected --
    else if (formattedError.errorCode === 500 || formattedError.errorCode === 503 || formattedError.errorCode === 504 || formattedError.errorCode === 0) {

      formattedError.action = 'message';
      formattedError.errorMessage += this.appData.errorMessage[formattedError.errorCode];

    }
    // -- 404 = endpoint not found --
    else if (formattedError.errorCode === 404) {

      formattedError.action = 'error';
      formattedError.errorMessage += this.appData.errorMessage[formattedError.errorCode];

    }
    // -- 403 = forbidden --
    else if (formattedError.errorCode === 403) {

      formattedError.action = 'message';
      formattedError.errorMessage += 'You do not have sufficient permission to perform this action.';

    }
    // --- then the most common errors 400 and 401
    // to make the error message more user friendly, we look at the original request
    // mostly to differentiate whether the error happened on initial authentification stage
    // or later inside the app flow after the user had already been able to do stuff

    // -- 401 = unauthorized --
    else if (formattedError.errorCode === 401) {

      formattedError.action = 'login';
      // detect if request was token with grant_type=password in which case 'Invalid username and password combination'
      // 'grant_type' is used in the GET token xhr body only
      if (options.data && options.data.match(/grant_type=password/))
      {
        formattedError.errorMessage += 'Invalid username and password combination. Please try log in again.';
      }
      // or if request was something else (content fetch/update/post), in which case 'your token has expired'
      else {
        formattedError.errorMessage += 'Your login has expired. Please try log in again.';
      }
    }
    // -- 400 = bad request --
    else if (formattedError.errorCode === 400) {

      // 400 is returned for a invalid refresh token, in which case login is required
      if (options.data && options.data.match(/grant_type=refresh_token/))
      {
        formattedError.action = 'login';
        formattedError.errorMessage += 'Your login has expired. Please try log in again.'
      }
      // getting a brand new token is the very first xhr request if it happens, 
      // or the second one after an invalid refresh token (case above) and the user had to login again
      // (so this second call will be caught here and we won't be trapped in endless login loop after an invalid refresh token)
      // in either case, it most likely means the app has changed the credentials server side
      // there is nothing the user can do except contact technical support
      else if (options.data && (options.data.match(/grant_type=password/) || options.data.match(/grant_type=client_credentials/)))
      {
        formattedError.action = 'error';
        formattedError.errorMessage += this.appData.errorMessage[formattedError.errorCode];
      }
      // - MM TODO when we integrate the quiz
      // - error 400 where no case matched the selected category on random quiz creation
      // - this should fail gracefully like when there is no search result, it's not a real error
      // -  when we integrate the quiz, figure out how to identify this particular request
      // - formattedError.errorMessage += 'No cases were found matching your selected categories. Please try another selection.';
      // - formattedError.action = "message";
      // else if request was anything else (content fetch/update/post)
      // if it's the very first xhr (if a valid token was found in local storage, no GET token would happen at all)
      // then it could mean the same major error of invalid app crefentials as above
      // howerer content xhr can happen at any time, and a 400 can just mean the specific content request was badly formatted
      // it may be a one-time problem and the user can continue doing other things with the app, unless errors keep happening
      // so we just display a warning message:
      //  - if one time bad format, user will see message once ad ignore it
      //  - if invalid app credentials, message will display repeatedly and subsequent xhr and user will know it's a serious error.
      else {
        formattedError.action = 'message';
        formattedError.errorMessage += 'There was a problem handling your request. Please contact technical support if problems persist.';
      }
    }

    console.log('ERROR');
    console.log(formattedError);

    // the view or module that originally called the error handler wants it to process the action itself
    // for most views this will be enough
    if (defaultAction) {

      // if the error action is a redirect (to login or error screen)
      // then notify the main app so it can route   
      if (formattedError.action === 'error' || formattedError.action === 'login') {

        // the view or module that originally called the error handler has dataChannel in its scope, use it
        if (this.dataChannel) {
          console.log('ROUTE DIRECTLY FROM ERROR HANDLER USING dataChannel  IN SCOPE');
          this.dataChannel.trigger('data:fetch:error', formattedError);
        }
        else {
          console.log('ROUTE DIRECTLY FROM ERROR HANDLER USING OWN dataChannel');
          var dataChannel = Backbone.Radio.channel('data');
          dataChannel.trigger('data:fetch:error', formattedError);
        }

      }
      // otherwise display a pop up error message on top of whatever view is currently on screen
      else if (formattedError.action === 'message') {

        console.log('SWAL DIRECTLY FROM ERROR HANDLER');
        swal(formattedError.errorMessage);
        
      }
    }

    // return formatted error to the view or module that originally called the error handler
    return formattedError;
  }
};
;/*************************************************************/
/* Local storage mixin 
/* put in the models that need saving to local storage
/* designed to work on standalone models because that's all we needed, would need adapting to work with collections
/* replace backbone.localStorage plugin because their destroy does not work properly on single models
/* MM 06/2017: now extended to work with collections as well
/*************************************************************/

BestForMe.LocalStorageMixin = {

  fetchLocalStorage: function() {

    var isCollection = this instanceof Backbone.Collection;
    var isModel = this instanceof Backbone.Model;

    // fetch a single model from local storage
    if (this instanceof Backbone.Model) {

      // we need a unique model ID to use as local storage key
      // backbone 'id' only exists once a model has been saved to the server. 
      // If a model is saved to local storage only, or before the server, 'id' is undefined
      // however backbone 'cid' exists as soon as the model is created locally, so use it
      var localStorageResult = localStorage.getItem(this.cid);
      //console.log('fetchLocalStorage cid :'+this.cid+', localStorageResult: '+ localStorageResult);
      if (localStorageResult) {
        this.set(JSON.parse(localStorageResult));
        return(this);
      }
      else {
        return false;
      }
    }
    // fetch a collection from local storage

  },

  saveLocalStorage: function() {
    //console.log('saveLocalStorage cid :'+this.cid);
    localStorage.setItem(this.cid, JSON.stringify(this.toJSON()));
  },

  destroyLocalStorage: function() {
    //console.log('destroyLocalStorage cid :'+this.cid);
    localStorage.removeItem(this.cid);
  }

};
;/**********************************************************************************/
/*  Changes the title of the page
 /**********************************************************************************/

BestForMe.ChangeTitleMixin = {

  changePageTitle: function (title, pageTitle) {
  console.log(title + ' - ' + pageTitle);
    var newTitle = null;
    if (title === pageTitle) {
      newTitle = title;
    }
    else {
      newTitle = pageTitle + ' - ' + title;
    }
    document.title = newTitle;
  }

};;/**********************************************************************************/
/*  Behaviours are methods shared between views to keep code DRY
/*  removeTemplateWrapperBehavior: prevent backbone from wrapping the template inside an extra div when inserting a view
/**********************************************************************************/

BestForMe.RemoveTemplateWrapperBehavior = Backbone.Marionette.Behavior.extend({
 
  onRender: function() {
  
    // only remove the wrapper if the template has one inbuilt (i.e. a single top child element)
    // do not remove if the template comtains several top level elements
    if (this.view.el.childElementCount === 1) {

      this.view.$el = this.view.$el.children();
      // Unwrap the element to prevent infinitely nesting elements during re-render.
      this.view.$el.unwrap();
      // ? Vanilla JS equivalent
      //this.el.outerHTML = this.el.innerHTML;
      this.view.setElement(this.view.$el);
    }
  }
});;/**********************************************************************************/
/*  Behaviours are methods shared between views to keep code DRY
/*  Internal links: programmatically triggers router.navigate on internal link click, needed when History pushstate is enabled
/**********************************************************************************/

BestForMe.InternalLinkBehavior = Marionette.Behavior.extend({
  
  ui: {
    // internal urls start with /
    link: 'a',
  },

  // Behaviors have events that are bound to the views DOM.
  events: {
    'click @ui.link': 'onLinkClicked'
  },

  onLinkClicked: function(e) {

    // MM: wacky JS vs. jQuery issue!
    // if you test on JS e.currentTarget.href, then even if you wrote href='/cases', it automatically prepends the base url 'www.domain.com/cases' so you can't detect internal links
    // thankfully jQuery $(e.currentTarget).attr('href') returns href as written, so we can use it to detect internal links
    // MM: check that href exists otherwise logout button gets treated as a link!!!
    if ($(e.currentTarget).attr('href') && $(e.currentTarget).attr('href').match(/^\//)) {

      // Prevent double event
      e.stopPropagation();
      // Prevent server request for new page, navigation is handled client-side by backbone router
      e.preventDefault();

      // href automatically adds the host name, pathname is just the route
      var routeName = e.currentTarget.pathname;
      console.log('InternalLinkBehavior.onLinkClicked INTERNAL LINK: '+routeName);

      // send an event telling main app to navigate to another view
      // if the view that uses this behaviour has routerChannel defined, use it
      if (this.view.routerChannel) {
        this.view.routerChannel.trigger('navigate:to:page', routeName);
      }
      // otherwise create one just to send the event
      else {
        var routerChannel = Backbone.Radio.channel('router');
        routerChannel.trigger('navigate:to:page', routeName);
      }
    }  

  }

});;/**********************************************************************************/
/*  Behaviours are methods shared between views to keep code DRY
/*  Logout Button
/**********************************************************************************/

BestForMe.LogoutBehavior = Marionette.Behavior.extend({

  ui: {
    logout: '.logout'
  },

  // Behaviors have events that are bound to the views DOM.
  events: {
    'click @ui.logout': 'onClickLogout'
  },

  onClickLogout: function() {

    // if the view that uses this behaviour has authChannel defined, use it
    if (this.view.authChannel) {
      var authChannel = this.view.authChannel;
    }
    // otherwise create one just to send the event
    else {
      var authChannel = Backbone.Radio.channel('auth');
    }

    swal({
      title: "Are you sure you would like to log out?",
      type: "warning",
      showCancelButton: true,
      confirmButtonText: "Log Out",
      closeOnConfirm: true
    }, function () {
      authChannel.trigger('log:out');
    });

  }

});
;/**********************************************************************************/
/*  Behaviours are methods shared between views to keep code DRY
/*  BestForMe.PaginationBehavior: pagination to put at bottom of list views
/*  view using this behavior must have:
/*    - 'collection' property
/*    - 'goToPage(pageIndex)' method: because the url to route to when changing page depends on the host view
/*    -  'templateHelpers' must send pagination to the template
/**********************************************************************************/

BestForMe.PaginationBehavior = Backbone.Marionette.Behavior.extend({
 
  ui: {
    goToPage: '.pagination-link'
  },

  events: {
    'click @ui.goToPage': 'goToPage'
  },

  pagination: {
    dotsPrevious: 0,
    previous: 0,
    current: 0,
    next: 0,
    dotsNext: 0,
    total: 0,
    showTotal: 0,
    showFirst: 0
  },

  onBeforeRender: function () {
    this.makePagination();
  },

    /**
   * Opens the page selected from pagination
   * @param e - Page click event
   */
  goToPage: function(e) {
    // send to the view because the url to route to when changing page depends on the host view
    var page = e.currentTarget.dataset.page;
    this.view.goToPage(page);
  },

  /**
   * Clear pagination settings
   */
  clearPagination: function() {
    this.pagination.dotsPrevious = 0;
    this.pagination.previous = 0;
    this.pagination.current = 0;
    this.pagination.next = 0;
    this.pagination.dotsNext = 0;
    this.pagination.total = 0;
    this.pagination.showTotal = 0;
    this.pagination.showFirst = 0;
  },

  /**
   * Generate pagination
   */
  makePagination: function() {

    // expose pagination object to the view so it can send it to the template
    this.view.pagination = this.pagination;

    // MM: necessary to clear the pagination when navigating back and forth between pages
    this.clearPagination();
    //check whether there are more items in the full collection that on the current page
    if (this.view.collection && this.view.collection.totalLength > this.view.collection.pageLength) {

      this.pagination.current = parseInt(this.view.collection.page);
      this.pagination.total = Math.ceil( this.view.collection.totalLength / this.view.collection.perPage);
      this.pagination.showTotal = 1;

      // always display the first page so user can quickly go back to it
      if (this.pagination.current > 2) {
        this.pagination.showFirst = 1;
      }
      if (this.pagination.current > 1) {
        this.pagination.previous = this.pagination.current - 1;
        if (this.pagination.previous > 2) {
          this.pagination.dotsPrevious = true;
        }
      }
      if ((this.pagination.total - this.pagination.current) > 1) {
        this.pagination.next = this.pagination.current + 1;
        if ((this.pagination.total - this.pagination.next) > 1) {
          this.pagination.dotsNext = true;
        }
      }
      // do not display same number twice
      if (this.pagination.total === this.pagination.current || this.pagination.total === this.pagination.next) {
        this.pagination.showTotal = 0;
      }

    }
  }

});;/* ----------------------------- */
/*   Client Credentials Model
/* ----------------------------- */

BestForMe.ClientCredentials = Backbone.Model.extend({

  defaults: {
    clientId: '',
    clientSecret: ''
  }
});
;/* ----------------------------- */
/*   User Login Model
/* ----------------------------- */

BestForMe.UserLogin = Backbone.Model.extend({

  defaults: {
    username: '',
    password: ''
  }

});;/* ----------------------------- */
/*   Oauth Token Model
/* ----------------------------- */

BestForMe.Token = Backbone.Model.extend({

  // token is single model used on its own so override the default backbone url logic based on collection and model ID
  apiUrl: null,

  url: function() {
      return this.apiUrl;
  },

  // default attributes
  defaults: {
    accessToken: '',
    expiresIn: '',
    tokenType: '',
    scope: '',
    refreshToken: '',
    expiryDate: '',
  },

  initialize : function(attrs, options) {
    this.apiUrl = options.url;
  },

  parse : function(response, options){

    console.log('token.parse options: '+JSON.stringify(options)+', response: '+ JSON.stringify(response));

    // contrary to previously used backbone.localstorage, our local storage mixin does not override default backbone methods
    // so parse is not called with local storage, so parse only need to handle the case of model retrieved from server
    // token retrieved from server has badly formatted attributes names
    var formattedResponse = {
      accessToken: response.access_token, 
      expiresIn: response.expires_in, 
      tokenType: response.token_type, 
      scope: response.scope,
      refreshToken: response.refresh_token, 
      expiryDate: this._calcExpiryDate(response.expires_in)
    };

    return formattedResponse;
  },

  // fake Private utility function to calculate Token Expiry Date
  // !!! could not find a reliable best way to make private functions in backbone model
  // !!! and I don't actively need to hide this function, it's just for tidyness, so leave as is for now
  _calcExpiryDate : function(expiresIn) {

    // expiresIn is a number of seconds but JS gives dates in ms
    return Date.now() + expiresIn * 1000;
  },

  // method to check whether a token retrieved from local storage has expired or not
  isValid : function() {

    var msBeforeExpiry = this.get('expiryDate') - Date.now();
    var isValid = (msBeforeExpiry > 0);
    console.log('token.isValid: '+this.get('accessToken')+' still valid? '+isValid+' for '+msBeforeExpiry+' ms');

    return isValid;
  }
});



;/* ----------------------------------- */
/*   Reset and Change Password Models
/* ----------------------------------- */

// Model used to request a password reset to server (when user not logged in)
BestForMe.PasswordResetRequest = Backbone.Model.extend({

  defaults: {
    // username whose password should be reset
    identifier: ''
  },

  // single model used on its own so override the default backbone url logic based on collection and model ID
  apiUrl: null,

  url: function() {
    return this.apiUrl;
  },

  initialize : function(attrs, options) {
    // endpoint is /user/reset-password
    this.apiUrl = options.userBaseUrl+'/reset-password';
  }

});

// model to change a password when user is not logged-in
// after a PasswordResetRequest above was successful and returned a resetKey from server
BestForMe.PasswordReset = Backbone.Model.extend({

  defaults: {
    username: '',
    password: '',
    resetKey: '',
    id: 1
  },

  // user is single model used on its own so override the default backbone url logic based on collection and model ID
  apiUrl: null,

  url: function() {
    return this.apiUrl;
  },

  initialize : function(model, options) {
    this.apiUrl = options.url;
  }

});

// model to change a password when user is logged-in
BestForMe.PasswordChange = Backbone.Model.extend({

  defaults: {
    oldPassword: '',
    password: '',
    id: 1
  },

  // user is single model used on its own so override the default backbone url logic based on collection and model ID
  apiUrl: null,

  url: function() {
    return this.apiUrl;
  },

  initialize : function(model, options) {
    this.apiUrl = options.url;
  }

});
;/* ----------------------------- */
/*   User Model
/* ----------------------------- */

BestForMe.User = Backbone.Model.extend({

  defaults: {
    message: '',
      firstName: '',
      lastName: '',
      nickName: '',
      username: '',
      userId: 0,
      email: '',
      permissions: '',
      location: '',
      avatar: '',
      powers: ''
  },

  // user is single model used on its own so override the default backbone url logic based on collection and model ID
  apiUrl: null,

  // stores if user is an admin
  isAdmin: false,

  // stores if the user can edit articles
  editArticles: false,

  // stores if the user can edit news
  editNews: false,

  url: function() {
      return this.apiUrl;
  },

  initialize : function(attrs, options) {
    this.apiUrl = options.url;
  },

  parse : function(response, options) {

    // server returns user data in 'result'
    var formattedUserData =  {
        message: response.result.message,
        firstName: response.result.first_name,
        lastName: response.result.last_name,
        nickName: response.result.nick_name,
        username: response.result.username,
        userId: response.result.user_id,
        email: response.result.email,
        color: response.result.color,
        permissions: response.result.permissions,
        location: response.result.location,
        avatar: response.result.avatar,
        powers: response.result.powers
    };

    if (formattedUserData.powers.includes('op_edit_admin') || formattedUserData.powers.includes('manage_articles')) {
      this.isAdmin = true;
    }
    else {
      this.isAdmin = false;
    }

    if (formattedUserData.powers.includes('op_edit_admin')) {
      this.editNews = true;
    }
    else {
      this.editNews = false;
    }

    if (formattedUserData.powers.includes('manage_articles')) {
      this.editArticles = true;
    }
    else {
      this.editArticles = false;
    }

    return formattedUserData;
  }

});
;this["BestForMe"] = this["BestForMe"] || {};
this["BestForMe"]["Templates"] = this["BestForMe"]["Templates"] || {};

this["BestForMe"]["Templates"]["agility/canvas-grid-item"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    return " disabled";
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {}, alias2=helpers.helperMissing, alias3="function", alias4=container.escapeExpression;

  return "<li class=\"canvas-hex\" id=\""
    + alias4(((helper = (helper = helpers.id || (depth0 != null ? depth0.id : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"id","hash":{},"data":data}) : helper)))
    + "\">\n  <div class=\"hex-in\">\n    <a class=\"hex-link "
    + alias4(((helper = (helper = helpers.hexType || (depth0 != null ? depth0.hexType : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"hexType","hash":{},"data":data}) : helper)))
    + "\">\n      <span class='hex-bg "
    + alias4(((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"type","hash":{},"data":data}) : helper)))
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.disabled : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "'></span>\n      <h1>"
    + alias4(((helper = (helper = helpers.title || (depth0 != null ? depth0.title : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"title","hash":{},"data":data}) : helper)))
    + "</h1>\n    </a>\n  </div>\n</li>";
},"useData":true});

this["BestForMe"]["Templates"]["agility/canvas-tray-item"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {}, alias2=helpers.helperMissing, alias3="function", alias4=container.escapeExpression, alias5=container.lambda;

  return "<li class=\"solution-hex\" id=\""
    + alias4(((helper = (helper = helpers.id || (depth0 != null ? depth0.id : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"id","hash":{},"data":data}) : helper)))
    + "\">\n  <div class=\"hex-in\">\n    <div class=\"hex-link "
    + alias4(((helper = (helper = helpers.hexType || (depth0 != null ? depth0.hexType : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"hexType","hash":{},"data":data}) : helper)))
    + "\">\n\n      <span class='hex-bg "
    + alias4(((helper = (helper = helpers.displayClass || (depth0 != null ? depth0.displayClass : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"displayClass","hash":{},"data":data}) : helper)))
    + "'></span>\n      <p class=\"hex-title\">"
    + alias4(((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"type","hash":{},"data":data}) : helper)))
    + "</p>\n      <div class=\"tab\">\n        <button class=\"tablinks solution-tab-button\">Solution</button>\n        <button class=\"tablinks impact-tab-button\">Impact</button>\n      </div>\n\n      <div class=\"solution-tab tab-content\">\n        <h1>"
    + alias4(((helper = (helper = helpers.description || (depth0 != null ? depth0.description : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"description","hash":{},"data":data}) : helper)))
    + "</h1>\n      </div>\n\n      <div class=\"impact-tab tab-content\">\n\n        <div class=\"impact-element no-edit\">\n          <p class=\"impact-title\">Cost</p>\n          <p class=\"impact-value\">"
    + alias4(alias5(((stack1 = ((stack1 = (depth0 != null ? depth0.impact : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.cost : stack1), depth0))
    + "</p>\n        </div>\n\n        <div class=\"impact-element no-edit\">\n          <p class=\"impact-title\">Quality</p>\n          <p class=\"impact-value\">"
    + alias4(alias5(((stack1 = ((stack1 = (depth0 != null ? depth0.impact : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.quality : stack1), depth0))
    + "</p>\n        </div>\n\n        <div class=\"impact-element no-edit\">\n          <p class=\"impact-title\">Time</p>\n          <p class=\"impact-value\">"
    + alias4(alias5(((stack1 = ((stack1 = (depth0 != null ? depth0.impact : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.time : stack1), depth0))
    + "</p>\n        </div>\n\n        <div class=\"impact-element no-edit\">\n          <p class=\"impact-title\">Sustainability</p>\n          <p class=\"impact-value\">"
    + alias4(alias5(((stack1 = ((stack1 = (depth0 != null ? depth0.impact : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.sustainability : stack1), depth0))
    + "</p>\n        </div>\n        \n      </div>\n\n    </div>\n  </div>\n</li>\n";
},"useData":true});

this["BestForMe"]["Templates"]["agility/canvas-tray-view"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<h2>Technical Solutions</h2>\n<ul class=\"solution-list\">\n</ul>";
},"useData":true});

this["BestForMe"]["Templates"]["agility/canvas-view"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<section id=\"canvas-tray\">\n</section>\n<section id=\"canvas-collection\" class=\"canvas-collection\">\n</section>\n<section id=\"canvas-filter\">\n</section>";
},"useData":true});

this["BestForMe"]["Templates"]["agility/solution-grid-item-input"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    return " disabled";
},"3":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {};

  return "          <textarea class=\"solution-input\" rows=\"2\">"
    + container.escapeExpression(((helper = (helper = helpers.title || (depth0 != null ? depth0.title : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(alias1,{"name":"title","hash":{},"data":data}) : helper)))
    + "</textarea>\n          <div class=\"hex-buttons\">\n"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.dataId : depth0),{"name":"if","hash":{},"fn":container.program(4, data, 0),"inverse":container.program(6, data, 0),"data":data})) != null ? stack1 : "")
    + "          </div>\n";
},"4":function(container,depth0,helpers,partials,data) {
    return "              <button class=\"hex-edit-confirm\">Confirm</button>\n              <button class=\"hex-edit-cancel\">Cancel</button>\n";
},"6":function(container,depth0,helpers,partials,data) {
    return "              <button class=\"hex-new-confirm\">Confirm</button>\n              <button class=\"hex-new-cancel\">Cancel</button>\n";
},"8":function(container,depth0,helpers,partials,data) {
    var helper;

  return "          <h1>"
    + container.escapeExpression(((helper = (helper = helpers.title || (depth0 != null ? depth0.title : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"title","hash":{},"data":data}) : helper)))
    + "</h1>\n          <div class=\"hex-buttons\">\n            <button class=\"hex-edit\">Edit</button>\n            <button class=\"hex-delete\">Delete</button>\n          </div>\n";
},"10":function(container,depth0,helpers,partials,data) {
    return " no-edit";
},"12":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "            <input class=\"impact-input cost-input\" type=\"range\" step=\"1\" min=\"1\" max=\"5\" list=\"tickmarks-cost\" "
    + ((stack1 = helpers["if"].call(depth0 != null ? depth0 : {},(depth0 != null ? depth0.dataId : depth0),{"name":"if","hash":{},"fn":container.program(13, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + ">\n            <datalist id=\"tickmarks-cost\">\n              <option value=\"1\" label=\"Low\">\n              <option value=\"2\">\n              <option value=\"3\">\n              <option value=\"4\">\n              <option value=\"5\" label=\"High\">\n              </datalist>\n";
},"13":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "value=\""
    + container.escapeExpression(container.lambda(((stack1 = ((stack1 = (depth0 != null ? depth0.impact : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.cost : stack1), depth0))
    + "\"";
},"15":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "            <p class=\"impact-value\">"
    + container.escapeExpression(container.lambda(((stack1 = ((stack1 = (depth0 != null ? depth0.impact : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.cost : stack1), depth0))
    + "</p>\n";
},"17":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "            <input class=\"impact-input quality-input\" type=\"range\" step=\"1\" min=\"1\" max=\"5\" list=\"tickmarks-quality\" "
    + ((stack1 = helpers["if"].call(depth0 != null ? depth0 : {},(depth0 != null ? depth0.dataId : depth0),{"name":"if","hash":{},"fn":container.program(18, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + ">\n            <datalist id=\"tickmarks-quality\">\n              <option value=\"1\" label=\"Low\">\n              <option value=\"2\">\n              <option value=\"3\">\n              <option value=\"4\">\n              <option value=\"5\" label=\"High\">\n            </datalist>\n";
},"18":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "value=\""
    + container.escapeExpression(container.lambda(((stack1 = ((stack1 = (depth0 != null ? depth0.impact : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.quality : stack1), depth0))
    + "\"";
},"20":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "            <p class=\"impact-value\">"
    + container.escapeExpression(container.lambda(((stack1 = ((stack1 = (depth0 != null ? depth0.impact : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.quality : stack1), depth0))
    + "</p>\n";
},"22":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "            <input class=\"impact-input time-input\" type=\"range\" step=\"1\" min=\"1\" max=\"5\" list=\"tickmarks-time\" "
    + ((stack1 = helpers["if"].call(depth0 != null ? depth0 : {},(depth0 != null ? depth0.dataId : depth0),{"name":"if","hash":{},"fn":container.program(23, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + ">\n            <datalist id=\"tickmarks-time\">\n              <option value=\"1\" label=\"Low\">\n              <option value=\"2\">\n              <option value=\"3\">\n              <option value=\"4\">\n              <option value=\"5\" label=\"Most\">\n            </datalist>\n";
},"23":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "value=\""
    + container.escapeExpression(container.lambda(((stack1 = ((stack1 = (depth0 != null ? depth0.impact : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.time : stack1), depth0))
    + "\"";
},"25":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "            <p class=\"impact-value\">"
    + container.escapeExpression(container.lambda(((stack1 = ((stack1 = (depth0 != null ? depth0.impact : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.time : stack1), depth0))
    + "</p>\n";
},"27":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "            <input class=\"impact-input sustain-input\" type=\"range\" step=\"1\" min=\"1\" max=\"5\" list=\"tickmarks-sustainability\" "
    + ((stack1 = helpers["if"].call(depth0 != null ? depth0 : {},(depth0 != null ? depth0.dataId : depth0),{"name":"if","hash":{},"fn":container.program(28, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + ">\n            <datalist id=\"tickmarks-sustainability\">\n              <option value=\"1\" label=\"Low\">\n              <option value=\"2\">\n              <option value=\"3\">\n              <option value=\"4\">\n              <option value=\"5\" label=\"High\">\n            </datalist>\n";
},"28":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "value=\""
    + container.escapeExpression(container.lambda(((stack1 = ((stack1 = (depth0 != null ? depth0.impact : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.sustainability : stack1), depth0))
    + "\"";
},"30":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "            <p class=\"impact-value\">"
    + container.escapeExpression(container.lambda(((stack1 = ((stack1 = (depth0 != null ? depth0.impact : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.sustainability : stack1), depth0))
    + "</p>\n";
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {}, alias2=helpers.helperMissing, alias3="function", alias4=container.escapeExpression;

  return "<li class=\"solution-hex\" id=\""
    + alias4(((helper = (helper = helpers.id || (depth0 != null ? depth0.id : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"id","hash":{},"data":data}) : helper)))
    + "\">\n  <div class=\"hex-in\">\n    <div class=\"hex-link "
    + alias4(((helper = (helper = helpers.hexType || (depth0 != null ? depth0.hexType : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"hexType","hash":{},"data":data}) : helper)))
    + "\">\n\n      <span class='hex-bg "
    + alias4(((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"type","hash":{},"data":data}) : helper)))
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.disabled : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "'></span>\n      <div class=\"tab\">\n        <button class=\"tablinks solution-tab-button\">Solution</button>\n        <button class=\"tablinks impact-tab-button\">Impact</button>\n      </div>\n\n      <div class=\"solution-tab tab-content\">\n"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.edit : depth0),{"name":"if","hash":{},"fn":container.program(3, data, 0),"inverse":container.program(8, data, 0),"data":data})) != null ? stack1 : "")
    + "      </div>\n\n      <div class=\"impact-tab tab-content\">\n\n        <div class=\"impact-element"
    + ((stack1 = helpers.unless.call(alias1,(depth0 != null ? depth0.edit : depth0),{"name":"unless","hash":{},"fn":container.program(10, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\">\n          <p class=\"impact-title\">Cost</p>\n"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.edit : depth0),{"name":"if","hash":{},"fn":container.program(12, data, 0),"inverse":container.program(15, data, 0),"data":data})) != null ? stack1 : "")
    + "        </div>\n\n        <div class=\"impact-element"
    + ((stack1 = helpers.unless.call(alias1,(depth0 != null ? depth0.edit : depth0),{"name":"unless","hash":{},"fn":container.program(10, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\">\n          <p class=\"impact-title\">Quality</p>\n"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.edit : depth0),{"name":"if","hash":{},"fn":container.program(17, data, 0),"inverse":container.program(20, data, 0),"data":data})) != null ? stack1 : "")
    + "        </div>\n\n        <div class=\"impact-element"
    + ((stack1 = helpers.unless.call(alias1,(depth0 != null ? depth0.edit : depth0),{"name":"unless","hash":{},"fn":container.program(10, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\">\n          <p class=\"impact-title\">Time</p>\n"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.edit : depth0),{"name":"if","hash":{},"fn":container.program(22, data, 0),"inverse":container.program(25, data, 0),"data":data})) != null ? stack1 : "")
    + "        </div>\n\n        <div class=\"impact-element"
    + ((stack1 = helpers.unless.call(alias1,(depth0 != null ? depth0.edit : depth0),{"name":"unless","hash":{},"fn":container.program(10, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\">\n          <p class=\"impact-title\">Sustainability</p>\n"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.edit : depth0),{"name":"if","hash":{},"fn":container.program(27, data, 0),"inverse":container.program(30, data, 0),"data":data})) != null ? stack1 : "")
    + "        </div>\n        \n      </div>\n\n    </div>\n  </div>\n</li>\n\n";
},"useData":true});

this["BestForMe"]["Templates"]["agility/solution-grid-item"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    return " disabled";
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {}, alias2=helpers.helperMissing, alias3="function", alias4=container.escapeExpression;

  return "<li class=\"solution-hex\" id=\""
    + alias4(((helper = (helper = helpers.id || (depth0 != null ? depth0.id : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"id","hash":{},"data":data}) : helper)))
    + "\">\n  <div class=\"hex-in\">\n    <a class=\"hex-link "
    + alias4(((helper = (helper = helpers.hexType || (depth0 != null ? depth0.hexType : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"hexType","hash":{},"data":data}) : helper)))
    + "\">\n      <span class='hex-bg "
    + alias4(((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"type","hash":{},"data":data}) : helper)))
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.disabled : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "'></span>\n      <h1>"
    + alias4(((helper = (helper = helpers.title || (depth0 != null ? depth0.title : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"title","hash":{},"data":data}) : helper)))
    + "</h1>\n    </a>\n  </div>\n</li>";
},"useData":true});

this["BestForMe"]["Templates"]["agility/solution-grid-view"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<ul id=\"solution-hex-grid\">\n</ul>\n\n";
},"useData":true});

this["BestForMe"]["Templates"]["agility/solution-view"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<section id=\"solution-grid\">\n</section>\n<section id=\"solution-filter\">\n</section>";
},"useData":true});

this["BestForMe"]["Templates"]["agility/tactic-view"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    var helper;

  return "  	<section id=\"error\">\n        <p>"
    + container.escapeExpression(((helper = (helper = helpers.errorMessage || (depth0 != null ? depth0.errorMessage : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"errorMessage","hash":{},"data":data}) : helper)))
    + "</p>\n    </section>\n";
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "<div class=\"final-tactic\">\n"
    + ((stack1 = helpers["if"].call(depth0 != null ? depth0 : {},(depth0 != null ? depth0.errorMessage : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "  <section id=\"canvas-grid\">\n  </section>\n  <section id=\"canvas-filter\">\n  </section>\n</div>";
},"useData":true});

this["BestForMe"]["Templates"]["agility/tactical-canvas-collection-view"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<section id=\"tactical-canvas-collection\" class=\"tactical-canvas-collection\">\n</section>\n\n<div class=\"add-canvas\">\n  <button id=\"add-canvas\" class=\"button\"></button>\n</div>";
},"useData":true});

this["BestForMe"]["Templates"]["agility/tactical-canvas-grid-view"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var helper, alias1=depth0 != null ? depth0 : {}, alias2=helpers.helperMissing, alias3="function", alias4=container.escapeExpression;

  return "  <section class=\"tactical-canvas-grid\">\n\n    <div class=\"canvas-connection-tray\">\n      <p>Drag and drop AND & OR to annotate the connections between solutions:</p>\n      <ul class=\"canvas-and-or-grid\">\n\n        <li class=\"boolean-hex and\">\n          <div class=\"hex-in\">\n            <a class=\"hex-link\" href=\"#\">\n              <span class='hex-bg "
    + alias4(((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"type","hash":{},"data":data}) : helper)))
    + "'></span>\n              <h1>AND</h1>\n            </a>\n          </div>\n        </li>\n        <li class=\"boolean-hex or\">\n          <div class=\"hex-in\">\n            <a class=\"hex-link\" href=\"#\">\n              <span class='hex-bg "
    + alias4(((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"type","hash":{},"data":data}) : helper)))
    + "'></span>\n              <h1>OR</h1>\n            </a>\n          </div>\n        </li>\n        <li class=\"boolean-hex clear\">\n          <div class=\"hex-in\">\n            <a class=\"hex-link\" href=\"#\">\n              <span class='hex-bg "
    + alias4(((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"type","hash":{},"data":data}) : helper)))
    + "'></span>\n              <h1>CLEAR</h1>\n            </a>\n          </div>\n        </li>\n\n      </ul>\n    </div>\n\n    <div class=\"canvas-grid\">\n      <ul class=\"canvas-grid-list\">\n      </ul>\n    </div>\n\n  </section>\n";
},"useData":true});

this["BestForMe"]["Templates"]["agility/tactical-canvas-info-view"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    var helper;

  return "    <textarea class=\"canvas-title-input\" name=\"canvas-title-input\" rows=\"1\">"
    + container.escapeExpression(((helper = (helper = helpers.canvasTitle || (depth0 != null ? depth0.canvasTitle : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"canvasTitle","hash":{},"data":data}) : helper)))
    + "</textarea>\n    <div class=\"canvas-buttons canvas-buttons-edit-mode\">\n      <button class=\"canvas-title-save\">Save</button>\n      <button class=\"canvas-delete\">Delete</button>\n    </div>\n";
},"3":function(container,depth0,helpers,partials,data) {
    var helper;

  return "    <h1 class=\"canvas-title\">"
    + container.escapeExpression(((helper = (helper = helpers.canvasTitle || (depth0 != null ? depth0.canvasTitle : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"canvasTitle","hash":{},"data":data}) : helper)))
    + "</h1>\n    <div class=\"canvas-buttons\">\n      <button class=\"canvas-title-edit\">Edit</button>\n      <button class=\"canvas-delete\">Delete</button>\n    </div>\n";
},"5":function(container,depth0,helpers,partials,data) {
    return "checked";
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {}, alias2=helpers.helperMissing, alias3="function", alias4=container.escapeExpression;

  return "<section class=\"tactical-canvas-info\">\n\n  <div class=\"tactical-canvas-title\">\n"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.edit : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0),"inverse":container.program(3, data, 0),"data":data})) != null ? stack1 : "")
    + "  </div>\n\n  <div class=\"tactical-canvas-meta\">\n    <p class=\"tactical-canvas-score\">Agility Score: "
    + alias4(((helper = (helper = helpers.agilityScore || (depth0 != null ? depth0.agilityScore : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"agilityScore","hash":{},"data":data}) : helper)))
    + "</p>\n    <p class=\"tactical-canvas-score\">Complexity Score: "
    + alias4(((helper = (helper = helpers.complexityScore || (depth0 != null ? depth0.complexityScore : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"complexityScore","hash":{},"data":data}) : helper)))
    + "</p>\n    <p class=\"pref-text\">Preferred Canvas? </p><input id='pref-canvas-"
    + alias4(((helper = (helper = helpers.id || (depth0 != null ? depth0.id : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"id","hash":{},"data":data}) : helper)))
    + "' type=\"checkbox\" class=\"preferred-checkbox star\" "
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.isFavourite : depth0),{"name":"if","hash":{},"fn":container.program(5, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "><label for=\"pref-canvas-"
    + alias4(((helper = (helper = helpers.id || (depth0 != null ? depth0.id : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"id","hash":{},"data":data}) : helper)))
    + "\"></label>\n  </div>\n\n</section>";
},"useData":true});

this["BestForMe"]["Templates"]["agility/tactical-canvas-item-view"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<section class=\"tactical-canvas\">\n\n  <div class=\"canvas-info\">\n  </div>\n\n  <div class=\"canvas-grid-ui\">\n  </div>\n\n</section>";
},"useData":true});

this["BestForMe"]["Templates"]["agility/technical-solution-filter-view"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    var helper, alias1=depth0 != null ? depth0 : {}, alias2=helpers.helperMissing, alias3="function", alias4=container.escapeExpression;

  return "\n    <div class=\"section agility-score\">\n      <h3>Agility Score:</h3>\n      <h3>"
    + alias4(((helper = (helper = helpers.agility || (depth0 != null ? depth0.agility : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"agility","hash":{},"data":data}) : helper)))
    + "</h3>\n    </div>\n    <div class=\"section complexity-score\">\n      <h3>Complexity Score:</h3>\n      <h3>"
    + alias4(((helper = (helper = helpers.complexity || (depth0 != null ? depth0.complexity : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"complexity","hash":{},"data":data}) : helper)))
    + "</h3>\n    </div>\n\n";
},"3":function(container,depth0,helpers,partials,data) {
    var stack1, alias1=depth0 != null ? depth0 : {};

  return "\n"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.showAgilityScore : depth0),{"name":"if","hash":{},"fn":container.program(4, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.showComplexityScore : depth0),{"name":"if","hash":{},"fn":container.program(6, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\n";
},"4":function(container,depth0,helpers,partials,data) {
    var helper;

  return "      <div class=\"section agility-score\">\n        <h3>Agility Score:</h3>\n        <h3>"
    + container.escapeExpression(((helper = (helper = helpers.agilityScore || (depth0 != null ? depth0.agilityScore : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"agilityScore","hash":{},"data":data}) : helper)))
    + "</h3>\n      </div>\n";
},"6":function(container,depth0,helpers,partials,data) {
    var helper;

  return "      <div class=\"section complexity-score\">\n        <h3>Complexity Score:</h3>\n        <h3>"
    + container.escapeExpression(((helper = (helper = helpers.complexityScore || (depth0 != null ? depth0.complexityScore : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"complexityScore","hash":{},"data":data}) : helper)))
    + "</h3>\n      </div>\n";
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {}, alias2=helpers.helperMissing, alias3="function", alias4=container.escapeExpression, alias5=container.lambda;

  return "<div class=\"technical-solution-filter\">\n\n"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.overrideScore : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0),"inverse":container.program(3, data, 0),"data":data})) != null ? stack1 : "")
    + "\n  <div class=\"section operational-need-summary\">\n    <h3 class=\"section-title\">Objective: "
    + alias4(((helper = (helper = helpers.name || (depth0 != null ? depth0.name : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"name","hash":{},"data":data}) : helper)))
    + "</h3>\n    <p>Tactical Family: "
    + alias4(alias5(((stack1 = ((stack1 = (depth0 != null ? depth0.tacticalFamily : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.name : stack1), depth0))
    + "</p>\n    <p>Solution Requirements: "
    + alias4(((helper = (helper = helpers.solutionRequirements || (depth0 != null ? depth0.solutionRequirements : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"solutionRequirements","hash":{},"data":data}) : helper)))
    + "</p>\n  </div>\n\n  <div class=\"section filter\">\n    <h3 class=\"section-title\">Global Scoring Paths</h3>\n    <p>Cost</p>\n    <input class=\"filter-input filter-cost\" type=\"range\" step=\"1\" min=\"1\" max=\"5\" list=\"tickmarks-cost\" name=\"cost\" value=\""
    + alias4(alias5(((stack1 = ((stack1 = (depth0 != null ? depth0.filter : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.cost : stack1), depth0))
    + "\">\n      <datalist id=\"tickmarks-cost\">\n        <option value=\"1\" label=\"1\">\n        <option value=\"2\">\n        <option value=\"3\">\n        <option value=\"4\">\n        <option value=\"5\" label=\"5\">\n      </datalist>\n    <p>Quality</p>\n    <input class=\"filter-input filter-quality\" type=\"range\" step=\"1\" min=\"1\" max=\"5\" list=\"tickmarks-quality\" name=\"quality\" value=\""
    + alias4(alias5(((stack1 = ((stack1 = (depth0 != null ? depth0.filter : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.quality : stack1), depth0))
    + "\">\n      <datalist id=\"tickmarks-quality\">\n        <option value=\"1\" label=\"1\">\n        <option value=\"2\">\n        <option value=\"3\">\n        <option value=\"4\">\n        <option value=\"5\" label=\"5\">\n      </datalist>\n    <p>Development Time</p>\n    <input class=\"filter-input filter-time\" type=\"range\" step=\"1\" min=\"1\" max=\"5\" list=\"tickmarks-time\" name=\"time\" value=\""
    + alias4(alias5(((stack1 = ((stack1 = (depth0 != null ? depth0.filter : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.time : stack1), depth0))
    + "\">\n      <datalist id=\"tickmarks-time\">\n        <option value=\"1\" label=\"1\">\n        <option value=\"2\">\n        <option value=\"3\">\n        <option value=\"4\">\n        <option value=\"5\" label=\"5\">\n      </datalist>\n    <p>Sustainability</p>\n    <input class=\"filter-input filter-sustainability\" type=\"range\" step=\"1\" min=\"1\" max=\"5\" list=\"tickmarks-sustainability\" name=\"sustainability\" value=\""
    + alias4(alias5(((stack1 = ((stack1 = (depth0 != null ? depth0.filter : depth0)) != null ? stack1.attributes : stack1)) != null ? stack1.sustainability : stack1), depth0))
    + "\">\n      <datalist id=\"tickmarks-sustainability\">\n        <option value=\"1\" label=\"1\">\n        <option value=\"2\">\n        <option value=\"3\">\n        <option value=\"4\">\n        <option value=\"5\" label=\"5\">\n      </datalist>\n  </div>\n\n</div>\n";
},"useData":true});

this["BestForMe"]["Templates"]["app-layout"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<header id=\"header\"></header>\n<main id=\"main\"></main>\n<tutorial id=\"tutorial\"></tutorial>\n<footer id=\"footer\"></footer>";
},"useData":true});

this["BestForMe"]["Templates"]["error-screen"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var helper;

  return "<section id=\"error\">\n  <div class=\"error-notice\">\n    <p class=\"error-message\">"
    + container.escapeExpression(((helper = (helper = helpers.message || (depth0 != null ? depth0.message : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"message","hash":{},"data":data}) : helper)))
    + "</p>\n  </div>\n</section>\n";
},"useData":true});

this["BestForMe"]["Templates"]["export/export-final-tactic"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<div class=\"export_canvas\">\n  <section id=\"canvas-grid\"></section>\n</div>\n";
},"useData":true});

this["BestForMe"]["Templates"]["export/operational-need-export"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<div class=\"export_operational-need\">\n  <section id=\"operational-need-list__tactical\">\n  </section>\n</div>\n";
},"useData":true});

this["BestForMe"]["Templates"]["export/parameter-export"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<div class=\"export_parameters\">\n  <section id=\"parameter-list__tactical\">\n  </section>\n</div>\n";
},"useData":true});

this["BestForMe"]["Templates"]["footer/footer"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    return " hidden";
},"3":function(container,depth0,helpers,partials,data) {
    var helper;

  return "/"
    + container.escapeExpression(((helper = (helper = helpers.operationalNeedId || (depth0 != null ? depth0.operationalNeedId : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"operationalNeedId","hash":{},"data":data}) : helper)));
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {}, alias2=helpers.helperMissing, alias3="function", alias4=container.escapeExpression;

  return "<footer class=\"footer\">\n  <div class=\"footer-container\">\n    <div class=\"footer-content\">\n      <div class=\"tutorial-button\">\n        <button id=\"show-tutorial\" class=\"button\"></button>\n      </div>\n      <div class=\"save-button"
    + ((stack1 = helpers.unless.call(alias1,(depth0 != null ? depth0.showSave : depth0),{"name":"unless","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\">\n        <button id=\"save-content\" class=\"button\"></button>\n      </div>\n      <div class=\"export-button"
    + ((stack1 = helpers.unless.call(alias1,(depth0 != null ? depth0.showExport : depth0),{"name":"unless","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\">\n        <a href=\""
    + alias4(((helper = (helper = helpers.origin || (depth0 != null ? depth0.origin : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"origin","hash":{},"data":data}) : helper)))
    + alias4(((helper = (helper = helpers.exportLink || (depth0 != null ? depth0.exportLink : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"exportLink","hash":{},"data":data}) : helper)))
    + alias4(((helper = (helper = helpers.projectId || (depth0 != null ? depth0.projectId : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"projectId","hash":{},"data":data}) : helper)))
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.operationalNeedId : depth0),{"name":"if","hash":{},"fn":container.program(3, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\" target=\"_blank\"><button id=\"export-content\" class=\"button\"></button></a>\n      </div>\n    </div>\n  </div>\n</footer>\n";
},"useData":true});

this["BestForMe"]["Templates"]["header"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    var helper;

  return ": "
    + container.escapeExpression(((helper = (helper = helpers.projectTitle || (depth0 != null ? depth0.projectTitle : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"projectTitle","hash":{},"data":data}) : helper)));
},"3":function(container,depth0,helpers,partials,data) {
    var helper;

  return " - "
    + container.escapeExpression(((helper = (helper = helpers.operationalNeedTitle || (depth0 != null ? depth0.operationalNeedTitle : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"operationalNeedTitle","hash":{},"data":data}) : helper)));
},"5":function(container,depth0,helpers,partials,data) {
    return "hidden";
},"7":function(container,depth0,helpers,partials,data,blockParams,depths) {
    var stack1, alias1=depth0 != null ? depth0 : {}, alias2=container.lambda, alias3=container.escapeExpression;

  return "  <li class=\"main-nav-item btn\">\n    <a class=\"main-nav-link "
    + ((stack1 = helpers["if"].call(alias1,((stack1 = (depth0 != null ? depth0.attributes : depth0)) != null ? stack1.active : stack1),{"name":"if","hash":{},"fn":container.program(8, data, 0, blockParams, depths),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\" href=\""
    + alias3(alias2(((stack1 = (depth0 != null ? depth0.attributes : depth0)) != null ? stack1.link : stack1), depth0))
    + "/"
    + alias3(alias2((depths[1] != null ? depths[1].projectId : depths[1]), depth0))
    + ((stack1 = helpers["if"].call(alias1,((stack1 = (depth0 != null ? depth0.attributes : depth0)) != null ? stack1.hasOperationalNeedParam : stack1),{"name":"if","hash":{},"fn":container.program(10, data, 0, blockParams, depths),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\" title=\""
    + alias3(alias2(((stack1 = (depth0 != null ? depth0.attributes : depth0)) != null ? stack1.title : stack1), depth0))
    + "\">\n      <span class=\"main-nav-link-title\">"
    + alias3(alias2(((stack1 = (depth0 != null ? depth0.attributes : depth0)) != null ? stack1.title : stack1), depth0))
    + "</span>\n    </a>\n  </li>\n";
},"8":function(container,depth0,helpers,partials,data) {
    return "is-active";
},"10":function(container,depth0,helpers,partials,data,blockParams,depths) {
    return "/"
    + container.escapeExpression(container.lambda((depths[1] != null ? depths[1].operationalNeedId : depths[1]), depth0));
},"12":function(container,depth0,helpers,partials,data,blockParams,depths) {
    var stack1, alias1=depth0 != null ? depth0 : {}, alias2=container.lambda, alias3=container.escapeExpression;

  return "    <li class=\"main-nav-item btn\">\n      <a class=\"main-nav-link "
    + ((stack1 = helpers["if"].call(alias1,((stack1 = (depth0 != null ? depth0.attributes : depth0)) != null ? stack1.active : stack1),{"name":"if","hash":{},"fn":container.program(8, data, 0, blockParams, depths),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\" href=\""
    + alias3(alias2(((stack1 = (depth0 != null ? depth0.attributes : depth0)) != null ? stack1.link : stack1), depth0))
    + "/"
    + alias3(alias2((depths[1] != null ? depths[1].projectId : depths[1]), depth0))
    + ((stack1 = helpers["if"].call(alias1,((stack1 = (depth0 != null ? depth0.attributes : depth0)) != null ? stack1.hasOperationalNeedParam : stack1),{"name":"if","hash":{},"fn":container.program(10, data, 0, blockParams, depths),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\" title=\""
    + alias3(alias2(((stack1 = (depth0 != null ? depth0.attributes : depth0)) != null ? stack1.title : stack1), depth0))
    + "\">\n        <span class=\"main-nav-link-title\">"
    + alias3(alias2(((stack1 = (depth0 != null ? depth0.attributes : depth0)) != null ? stack1.title : stack1), depth0))
    + "</span>\n      </a>\n    </li>\n";
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data,blockParams,depths) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {};

  return "<div id=\"header-inner\" class=\"header-inner\">\n\n  <div class=\"brand\">\n    <div class=\"brand-logo\"></div>\n    <a href=\""
    + container.escapeExpression(((helper = (helper = helpers.home || (depth0 != null ? depth0.home : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(alias1,{"name":"home","hash":{},"data":data}) : helper)))
    + "\"><h1 class=\"brand-title\">MSF Pathways"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.projectTitle : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0, blockParams, depths),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.operationalNeedTitle : depth0),{"name":"if","hash":{},"fn":container.program(3, data, 0, blockParams, depths),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "</h1></a>\n  </div>\n\n</div>\n\n<ul id=\"header-nav\" class=\""
    + ((stack1 = helpers.unless.call(alias1,(depth0 != null ? depth0.showNav : depth0),{"name":"unless","hash":{},"fn":container.program(5, data, 0, blockParams, depths),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\">\n"
    + ((stack1 = helpers.each.call(alias1,((stack1 = (depth0 != null ? depth0.nav : depth0)) != null ? stack1.models : stack1),{"name":"each","hash":{},"fn":container.program(7, data, 0, blockParams, depths),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "</ul>\n\n<ul id=\"agility-nav\" class=\""
    + ((stack1 = helpers.unless.call(alias1,(depth0 != null ? depth0.showAgilityNav : depth0),{"name":"unless","hash":{},"fn":container.program(5, data, 0, blockParams, depths),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\">\n"
    + ((stack1 = helpers.each.call(alias1,((stack1 = (depth0 != null ? depth0.agility : depth0)) != null ? stack1.models : stack1),{"name":"each","hash":{},"fn":container.program(12, data, 0, blockParams, depths),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "</ul>\n\n";
},"useData":true,"useDepths":true});

this["BestForMe"]["Templates"]["home-screen"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<section id=\"home\">\n\n  <ul id=\"project-grid\" class=\"project-grid\">\n    <li class=\"project-hex\">\n      <div class=\"hex-in\">\n        <div class=\"hex-link\">\n          <span class='hex-bg'></span>\n          <h1>New Project</h1>\n          <button id=\"new-project-button\" class=\"project-open new-button\">+</button>\n        </div>\n      </div>\n    </li>\n    <li id=\"create-project\" class=\"project-hex\">\n      <div class=\"hex-in\">\n        <a class=\"hex-link\" href=\"#\">\n          <span class='hex-bg'></span>\n          <input class=\"project-name-input\"> </input>\n          <button id=\"create-project-button\" class=\"project-open new-button\">Create</button>\n        </a>\n      </div>\n    </li>\n    <div id=\"project-list\">\n\n    </div>\n  </ul>\n\n</section>\n";
},"useData":true});

this["BestForMe"]["Templates"]["loading-screen"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<section id=\"loading\">\n  <div class=\"loader\"></div>\n</section>\n";
},"useData":true});

this["BestForMe"]["Templates"]["login-screen"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<div class=\"full\">\n  <div class=\"login-divide\"><div id=\"login-brand\"></div></div>\n<main id=\"login-screen\">\n\n  <form class=\"login-form\">\n    <label for=\"username\">\n    </label>\n    <input name=\"username\" placeholder=\"Username\" class=\"login-username\" type=\"text\">\n    </input>\n    <label for=\"password\">\n    </label>\n    <input name=\"password\" placeholder=\"Password\" class=\"login-password\" type=\"password\">\n    </input>\n    <div class=\"login-forgotten-password\">\n      <input type=\"checkbox\" class=\"login-save-checkbox\" name=\"login-save\" value=\"login-save\"></input>\n      <p class=\"login-save-prompt\">Stay Logged In?</p>\n      <span class=\"login-reset-password\">Forgotten Password?</span>\n    </div>\n    <div class=\"login-button\">\n      <button tname=\"submit\" class=\"login-submit\" type=\"button\">Log in</button>\n    </div>\n  </form>\n</main>\n  <footer class=\"login-footer\">\n    <div class=\"login-footer-items\">\n    <span class=\"login-footer-icon\"></span>\n    <p class=\"login-footer-text\">Powered by BestForMe</p>\n    </div>\n  </footer>\n</div>\n";
},"useData":true});

this["BestForMe"]["Templates"]["parameters/parameter-grid-item"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var helper, alias1=depth0 != null ? depth0 : {}, alias2=helpers.helperMissing, alias3="function", alias4=container.escapeExpression;

  return "<li class=\"parameter-hex\" id=\""
    + alias4(((helper = (helper = helpers.id || (depth0 != null ? depth0.id : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"id","hash":{},"data":data}) : helper)))
    + "\">\n  <div class=\"hex-in\">\n    <a class=\"hex-link "
    + alias4(((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"type","hash":{},"data":data}) : helper)))
    + "\">\n      <span class='hex-bg "
    + alias4(((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"type","hash":{},"data":data}) : helper)))
    + "'></span>\n      <h1>"
    + alias4(((helper = (helper = helpers.title || (depth0 != null ? depth0.title : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"title","hash":{},"data":data}) : helper)))
    + "</h1>\n    </a>\n  </div>\n</li>";
},"useData":true});

this["BestForMe"]["Templates"]["parameters/parameter-grid"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<section class=\"parameter-grid\">\n  <h1 class=\"page-title\">Parameter Guide</h1>\n  <ul id=\"parameter-hex-grid\" data-style=\"display: flex;\">\n\n  </ul>\n</section>";
},"useData":true});

this["BestForMe"]["Templates"]["parameters/parameter-item"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {};

  return "    <div class=\"parameter-description\">\n      <p>"
    + container.escapeExpression(((helper = (helper = helpers.description || (depth0 != null ? depth0.description : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(alias1,{"name":"description","hash":{},"data":data}) : helper)))
    + "</p>\n    </div>\n"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.isCustom : depth0),{"name":"if","hash":{},"fn":container.program(2, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "");
},"2":function(container,depth0,helpers,partials,data) {
    return "      <div class=\"parameter-delete\">\n        <button class=\"parameter-delete-button\" name=\"parameter-delete\"></button>\n      </div>\n";
},"4":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "\n"
    + ((stack1 = helpers["if"].call(depth0 != null ? depth0 : {},(depth0 != null ? depth0.textInput : depth0),{"name":"if","hash":{},"fn":container.program(5, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\n";
},"5":function(container,depth0,helpers,partials,data) {
    var helper;

  return "      <div class=\"parameter-input\">\n        <textarea class=\"user-input\" name=\"parameter-input\" rows=\"5\">"
    + container.escapeExpression(((helper = (helper = helpers.userText || (depth0 != null ? depth0.userText : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"userText","hash":{},"data":data}) : helper)))
    + "</textarea>\n      </div>\n";
},"7":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "\n"
    + ((stack1 = helpers["if"].call(depth0 != null ? depth0 : {},(depth0 != null ? depth0.textInput : depth0),{"name":"if","hash":{},"fn":container.program(8, data, 0),"inverse":container.program(10, data, 0),"data":data})) != null ? stack1 : "")
    + "\n";
},"8":function(container,depth0,helpers,partials,data) {
    var helper;

  return "    \n      <div class=\"parameter-user-text parameter-description\">\n        <p>"
    + container.escapeExpression(((helper = (helper = helpers.userText || (depth0 != null ? depth0.userText : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"userText","hash":{},"data":data}) : helper)))
    + "</p>\n      </div>\n\n";
},"10":function(container,depth0,helpers,partials,data) {
    var stack1, alias1=depth0 != null ? depth0 : {};

  return "\n      <div class=\"parameter-option-display parameter-description\">\n        <ul class=\"parameter-option-list\">\n\n"
    + ((stack1 = helpers.each.call(alias1,((stack1 = (depth0 != null ? depth0.options : depth0)) != null ? stack1.models : stack1),{"name":"each","hash":{},"fn":container.program(11, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\n"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.userText : depth0),{"name":"if","hash":{},"fn":container.program(14, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\n        </ul>\n      </div>\n\n";
},"11":function(container,depth0,helpers,partials,data) {
    var stack1;

  return ((stack1 = helpers["if"].call(depth0 != null ? depth0 : {},((stack1 = (depth0 != null ? depth0.attributes : depth0)) != null ? stack1.selected : stack1),{"name":"if","hash":{},"fn":container.program(12, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "");
},"12":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "              <li class=\"parameter-option\">\n                <p>"
    + container.escapeExpression(container.lambda(((stack1 = (depth0 != null ? depth0.attributes : depth0)) != null ? stack1.name : stack1), depth0))
    + "</p>\n              </li>\n";
},"14":function(container,depth0,helpers,partials,data) {
    var helper;

  return "            <li class=\"parameter-option\">\n              <p>"
    + container.escapeExpression(((helper = (helper = helpers.userText || (depth0 != null ? depth0.userText : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"userText","hash":{},"data":data}) : helper)))
    + "</p>\n            </li>\n";
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {}, alias2=helpers.helperMissing, alias3="function", alias4=container.escapeExpression;

  return "<div class=\"parameter-item "
    + alias4(((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"type","hash":{},"data":data}) : helper)))
    + "\" id=\""
    + alias4(((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"type","hash":{},"data":data}) : helper)))
    + alias4(((helper = (helper = helpers.paramId || (depth0 != null ? depth0.paramId : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"paramId","hash":{},"data":data}) : helper)))
    + "\" data-id=\""
    + alias4(((helper = (helper = helpers.paramId || (depth0 != null ? depth0.paramId : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"paramId","hash":{},"data":data}) : helper)))
    + "\">\n  <div class=\"parameter-item-hex\">\n    <div class=\"hex-container\">\n      <div class=\"hex-item\" id=\"1\">\n        <div class=\"hex-in\">\n          <a class=\"hex-link\">\n            <span class='hex-bg "
    + alias4(((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"type","hash":{},"data":data}) : helper)))
    + "'></span>\n            <h1>"
    + alias4(((helper = (helper = helpers.name || (depth0 != null ? depth0.name : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"name","hash":{},"data":data}) : helper)))
    + "</h1>\n          </a>\n        </div>\n      </div>\n    </div>\n  </div>\n\n  \n"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.edit : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\n  <div class=\"parameter-options-dropdown\"></div>\n  <div class=\"parameter-options-checkbox\"></div>\n\n"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.edit : depth0),{"name":"if","hash":{},"fn":container.program(4, data, 0),"inverse":container.program(7, data, 0),"data":data})) != null ? stack1 : "")
    + "\n</div>\n";
},"useData":true});

this["BestForMe"]["Templates"]["parameters/parameter-list"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    var helper, alias1=depth0 != null ? depth0 : {}, alias2=helpers.helperMissing, alias3="function", alias4=container.escapeExpression;

  return "<section id=\"new-parameter\" class=\"parameter-item-list\">\n  <div class=\"parameter-item "
    + alias4(((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"type","hash":{},"data":data}) : helper)))
    + alias4(((helper = (helper = helpers.paramId || (depth0 != null ? depth0.paramId : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"paramId","hash":{},"data":data}) : helper)))
    + "\" data-id=\""
    + alias4(((helper = (helper = helpers.paramId || (depth0 != null ? depth0.paramId : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"paramId","hash":{},"data":data}) : helper)))
    + "\">\n    <div class=\"parameter-item-hex\">\n      <div class=\"hex-container\">\n        <div class=\"hex-item\" id=\"1\">\n          <div class=\"hex-in\">\n            <a class=\"hex-link\">\n              <span class='hex-bg "
    + alias4(((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"type","hash":{},"data":data}) : helper)))
    + "'></span>\n              <h1>New Parameter</h1>\n            </a>\n          </div>\n        </div>\n      </div>\n    </div>\n\n    <div class=\"parameter-name\">\n      <p>Please enter the name of the new parameter:</p>\n    </div>\n\n    <div class=\"parameter-name-input-wrapper\">\n      <textarea class=\"user-input parameter-name-input\" name=\"parameter-name-input\" rows=\"2\"></textarea>\n    </div>\n\n    <div class=\"parameter-type\">\n      <p>Please select the type of the new parameter:</p>\n    </div>\n\n    <div class=\"parameter-type-dropdown\">\n      <select class=\"parameter-type-select\">\n        <option class=\"parameter-type-option\" value=\"medical\">Medical</option>\n        <option class=\"parameter-type-option\" value=\"political\">Political</option>\n        <option class=\"parameter-type-option\" value=\"contextual\">Contextual</option>\n      </select>\n    </div>\n\n    <div class=\"parameter-description\">\n      <p>Please enter the details for the new parameter:</p>\n    </div>\n\n    <div class=\"parameter-description-input-wrapper\">\n      <textarea class=\"user-input parameter-description-input\" name=\"parameter-description-input\" rows=\"5\"></textarea>\n    </div>\n\n    <div class=\"add-parameter-button\">\n      <button id=\"add-parameter-button\" class=\"button\"> </button>\n    </div>\n\n  </div>\n</section>\n";
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "<section id=\"parameter-item-list\" class=\"parameter-item-list\">\n\n</section>\n\n"
    + ((stack1 = helpers["if"].call(depth0 != null ? depth0 : {},(depth0 != null ? depth0.edit : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "");
},"useData":true});

this["BestForMe"]["Templates"]["parameters/parameter-option-checkbox"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    var stack1, alias1=container.lambda, alias2=container.escapeExpression;

  return "        	<li class=\"parameter-option\">\n          	<label><input class=\"parameter-option-checkbox\" type=\"checkbox\" data-option-id=\""
    + alias2(alias1((depth0 != null ? depth0.optionId : depth0), depth0))
    + "\" "
    + ((stack1 = helpers["if"].call(depth0 != null ? depth0 : {},(depth0 != null ? depth0.selected : depth0),{"name":"if","hash":{},"fn":container.program(2, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + ">"
    + alias2(alias1((depth0 != null ? depth0.name : depth0), depth0))
    + "</label>\n        	</li>\n";
},"2":function(container,depth0,helpers,partials,data) {
    return "checked";
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {};

  return "<div class=\"parameter-option-checkboxes-wrapper\">	\n	<ul class=\"parameter-option-checkboxes\">\n"
    + ((stack1 = helpers.each.call(alias1,(depth0 != null ? depth0.items : depth0),{"name":"each","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "	</ul>\n	<div class=\"parameter-option-other-specify\">\n		<textarea class=\"user-input parameter-option-other-input\" name=\"parameter-option-other-input\" rows=\"2\">"
    + container.escapeExpression(((helper = (helper = helpers.otherText || (depth0 != null ? depth0.otherText : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(alias1,{"name":"otherText","hash":{},"data":data}) : helper)))
    + "</textarea>\n	</div>\n</div>\n";
},"useData":true});

this["BestForMe"]["Templates"]["parameters/parameter-option-select"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    var stack1, alias1=container.lambda, alias2=container.escapeExpression;

  return "        	<option class=\"parameter-option\" value=\""
    + alias2(alias1((depth0 != null ? depth0.optionId : depth0), depth0))
    + "\" "
    + ((stack1 = helpers["if"].call(depth0 != null ? depth0 : {},(depth0 != null ? depth0.selected : depth0),{"name":"if","hash":{},"fn":container.program(2, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + ">"
    + alias2(alias1((depth0 != null ? depth0.name : depth0), depth0))
    + "</option>\n";
},"2":function(container,depth0,helpers,partials,data) {
    return "selected";
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {};

  return "<div class=\"parameter-option-select-wrapper\">\n	<select class=\"parameter-option-select\">\n"
    + ((stack1 = helpers.each.call(alias1,(depth0 != null ? depth0.items : depth0),{"name":"each","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "	</select>\n    <div class=\"parameter-option-other-specify\">\n		<textarea class=\"user-input parameter-option-other-input\" name=\"parameter-option-other-input\" rows=\"2\">"
    + container.escapeExpression(((helper = (helper = helpers.otherText || (depth0 != null ? depth0.otherText : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(alias1,{"name":"otherText","hash":{},"data":data}) : helper)))
    + "</textarea>\n	</div>\n</div>";
},"useData":true});

this["BestForMe"]["Templates"]["parameters/parameter-view"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<section id=\"parameter-grid\">\n\n</section>\n<section id=\"parameter-list\">\n\n</section>";
},"useData":true});

this["BestForMe"]["Templates"]["project/project-item"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var helper;

  return "<li class=\"project-link\">\n  <div class=\"hex-in\">\n    <a class=\"hex-link\">\n      <span class='hex-bg'></span>\n      <h1>"
    + container.escapeExpression(((helper = (helper = helpers.name || (depth0 != null ? depth0.name : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"name","hash":{},"data":data}) : helper)))
    + "</h1>\n      <button class=\"project-open new-button\">Open</button>\n    </a>\n  </div>\n</li>";
},"useData":true});

this["BestForMe"]["Templates"]["project/project-list"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<section id=\"projects\">\n\n  <ul id=\"project-grid\" class=\"project-grid\">\n\n    <li id=\"new-project\" class=\"project-hex\">\n      <div class=\"hex-in\">\n        <div class=\"hex-link\">\n          <span class=\"hex-bg\"></span>\n          <h1>New Project</h1>\n          <button id=\"new-project-button\" class=\"project-new new-button\">+</button>\n        </div>\n      </div>\n    </li>\n\n    <li id=\"create-project\" class=\"project-hex\">\n      <div class=\"hex-in\">\n        <a class=\"hex-link\" href=\"#\">\n          <span class=\"hex-bg\"></span>\n          <input type=\"text\" class=\"project-name-input\" placeholder=\"Project name\">\n          <button id=\"create-project-button\" class=\"project-create new-button\">Create</button>\n        </a>\n      </div>\n    </li>\n\n  </ul>\n\n  <ul id=\"project-list\">\n\n  </ul>\n\n</section>\n";
},"useData":true});

this["BestForMe"]["Templates"]["tactical/operational-need-item"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    return "        <button class=\"operational-need-delete\" name=\"operational-need-delete\"></button>\n";
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {}, alias2=helpers.helperMissing, alias3="function", alias4=container.escapeExpression;

  return "<section class=\"operational-need-item\">\n\n<button class=\"accordion\">Operational Need: "
    + alias4(((helper = (helper = helpers.name || (depth0 != null ? depth0.name : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"name","hash":{},"data":data}) : helper)))
    + "</button>\n\n<div class=\"panel\">\n  <div class=\"operational-need-item\">\n\n    <div class=\"section need-title\">\n      <h3>Operational Need</h3>\n      <p class=\"section-label\">Define the need that the tactic must address</p>\n      <textarea class=\"title-input\" name=\"Operational Need Title\" rows=\"3\" >"
    + alias4(((helper = (helper = helpers.name || (depth0 != null ? depth0.name : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"name","hash":{},"data":data}) : helper)))
    + "</textarea>\n    </div>\n\n    <div class=\"section tactical-family\">\n      <h3 class=\"section-title\">Tactical Family</h3>\n      <p class=\"section-label\">Select the corresponding tactical family</p>\n      <div class=\"tactical-family-dropdown\">\n      </div>\n    </div>\n\n    <div class=\"section solution-requirements\">\n      <h3 class=\"section-title\">Solution Requirements</h3>\n      <p class=\"section-label\">Take into account the key parameters. Write the conditions that the solutions must fulfil, starting from the most important. Use keywords</p>\n      <textarea class=\"requirements-input\" name=\"Solution Requirements\" rows=\"10\" >"
    + alias4(((helper = (helper = helpers.solutionRequirements || (depth0 != null ? depth0.solutionRequirements : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"solutionRequirements","hash":{},"data":data}) : helper)))
    + "</textarea>\n    </div>\n\n    <div class=\"section technical-families\">\n      <h3 class=\"section-title\">Technical Families Implicated</h3>\n      <p class=\"section-label\">Select which technical families are implicated. Select the main one(s) first</p>\n      <div class=\"technical-families-grid\">\n      </div>\n    </div>\n\n    <div class=\"section departments\">\n      <h3 class=\"section-title\">Other Departments Implicated</h3>\n      <p class=\"section-label\">Identify the support requested for staffing and Supply</p>\n      <textarea class=\"departments-input\" name=\"Departments Implicated\" rows=\"10\">"
    + alias4(((helper = (helper = helpers.otherDepartments || (depth0 != null ? depth0.otherDepartments : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"otherDepartments","hash":{},"data":data}) : helper)))
    + "</textarea>\n    </div>\n\n    <div class=\"section stakeholders\">\n      <h3 class=\"section-title\">Role of External Stakeholders</h3>\n      <p class=\"section-label\">Possible collaborations and coordination that might be needed for your project</p>\n      <textarea class=\"stakeholders-input\" name=\"External Stakeholders\" rows=\"10\">"
    + alias4(((helper = (helper = helpers.externalStakeholders || (depth0 != null ? depth0.externalStakeholders : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"externalStakeholders","hash":{},"data":data}) : helper)))
    + "</textarea>\n    </div>\n\n    <section class=\"section operational-need-buttons\">\n"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.deleteAllowed : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "      <button class=\"operational-need-save\" name=\"operational-need-save\"></button>\n    </section>\n\n  </div>\n</div>\n\n</section>\n";
},"useData":true});

this["BestForMe"]["Templates"]["tactical/operational-need-list"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<section id=\"operational-need-list\" class=\"operational-need-list\">\n\n</section>\n\n<div class=\"add-operational-need\">\n  <button id=\"add-operational-need\" class=\"button\"></button>\n</div>";
},"useData":true});

this["BestForMe"]["Templates"]["tactical/tactical-family-select"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    var stack1, alias1=container.lambda, alias2=container.escapeExpression;

  return "        <option class=\"tactical-option\" value=\""
    + alias2(alias1((depth0 != null ? depth0.familyId : depth0), depth0))
    + "\" "
    + ((stack1 = helpers["if"].call(depth0 != null ? depth0 : {},(depth0 != null ? depth0.selected : depth0),{"name":"if","hash":{},"fn":container.program(2, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + ">"
    + alias2(alias1((depth0 != null ? depth0.name : depth0), depth0))
    + "</option>\n";
},"2":function(container,depth0,helpers,partials,data) {
    return "selected";
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1;

  return "<select class=\"tactical-family-select\">\n"
    + ((stack1 = helpers.each.call(depth0 != null ? depth0 : {},(depth0 != null ? depth0.items : depth0),{"name":"each","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "</select>\n";
},"useData":true});

this["BestForMe"]["Templates"]["tactical/tactical-view"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<section id=\"parameter-list__tactical\">\n</section>\n<section id=\"operational-need-list__tactical\">\n</section>";
},"useData":true});

this["BestForMe"]["Templates"]["tactical/technical-family-item"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    return " active";
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {}, alias2=helpers.helperMissing, alias3="function", alias4=container.escapeExpression;

  return "<li class=\"technical-hex\" id=\""
    + alias4(((helper = (helper = helpers.id || (depth0 != null ? depth0.id : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"id","hash":{},"data":data}) : helper)))
    + "\">\n  <div class=\"hex-in\">\n    <a class=\"hex-link\" href=\"#\">\n      <span class='hex-bg "
    + alias4(((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"type","hash":{},"data":data}) : helper)))
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.selected : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "'></span>\n      <h1>"
    + alias4(((helper = (helper = helpers.name || (depth0 != null ? depth0.name : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"name","hash":{},"data":data}) : helper)))
    + "</h1>\n    </a>\n  </div>\n</li>";
},"useData":true});

this["BestForMe"]["Templates"]["tactical/technical-family-list"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<ul id=\"technical-family-list\">\n\n</ul>";
},"useData":true});

this["BestForMe"]["Templates"]["tutorials/pages/agility-matrix-example"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<h1>Agility Matrix Example</h1>\n<h2>Jackie in South Sudan, Step 3: Agility Matrix</h2>\n<h2>Option infrastructures:</h2>\n<ul>\n    <li>Elevated prefabricated structure, international. Scoring: Quality/good, Cost/high, Time/high, Sustainability/high</li>\n    <li>Modular prefabricated structure, regional. Scoring: Quality/Low-medium, Cost/medium, Time/low, Sustainability/medium-high</li>\n    <li>Mud bricks buildings with drainage underneath, local. Scoring: Quality/medium, Cost/low, Time/medium-low, Sustainability/low</li>\n</ul>\n<h2>Options HFM:</h2>\n<ul>\n    <li>Master plan N°1, location in the OPD entrance. Scoring: Quality/good, Time/medium, Cost/high Sustainability/medium<br>This option is good for the flow of the patients and the gender separation possibilities.</li>\n    <li>Master plan N°2, location in-between the OPD and the IPD, 2 floor construction. Scoring: Quality/medium, Cost/low, Time/high, Sustainability/medium <br>This option is good for the possibility of future extension and for the flow of the staff.</li>\n</ul>\n<h2>Options energy:</h2>\n<ul>\n    <li>Additional generator, local. Scoring: Quality/medium-good, Cost/medium, Time/medium, Sustainability/medium-high <br>The energy referent said that with the generator, energy needs will be covered.</li>\n    <li>Solar panels, regional. Scoring: Quality/good, Cost/high, Time/high, Sustainability/high <br>The energy referent said that we will need a specialist to implement the solar panels and that we will need a lot of panels, to make sure we have sufficient energy.</li>\n    <li>Hybrid generator/solar panel, international : Quality/good, Cost/medium, Time/high, Sustainability/medium-high <br>The energy referent said we could have direct solar energy during the day and the addition of a smaller generator for the night. As the installation is simple, there is no need to have specific resources to implement it.</li>\n</ul>\n<h2>Options Watsan:</h2>\n<ul>\n    <li>Standard plumbing network + drainage underneath the new construction</li>\n</ul>\n<h2>Options cold chain:</h2>\n<ul>\n    <li>Standard fridge for vaccine, regional stock. Scoring: Quality/good, Cost/medium, Time/low, Sustainability/medium</li>\n    <li>Solar fridge for vaccine, international. Scoring: Quality/good, Cost/medium, Time/high, Sustainability/high</li>\n    <li>Reuse existing fridge, local. Scoring: Quality/good, Cost/low, Time/low, Sustainability/medium</li>\n</ul>";
},"useData":true});

this["BestForMe"]["Templates"]["tutorials/pages/agility-matrix-tutorial"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<h1>Agility Matrix Tutorial</h1>\n\n<h2>Technical Solution Library</h2>\n<p>Input up to 3 solutions for each Tactical Family</p>\n<h2>Tactical Canvas</h2>\n<p>Drag and drop the solutions from the library</p>\n<p>Connect the solutions that better answer the operation need, with and/or hexagons</p>\n<h2>Final Tactic</h2>\n<p>Evaluate your final tactic through the scoring paths</p>";
},"useData":true});

this["BestForMe"]["Templates"]["tutorials/pages/parameter-example"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<h1>Parameter Guide Example</h1>\n<h2>Jackie in South-Sudan, Step 1 : Parameter Guide</h2>\n<h2>Medical activity:</h2>\n<p>The out-patient clinic should be improved with more consultation rooms for family planning, ante and post-natal care. Vaccination of the women should be done.</p>\n<h2>Targeted beneficiaries:</h2>\n<p>There is a general target on refugees. There is a specific target on the care of women (Sexual Reproductive Health)</p>\n<h2>Total number of beneficiaries:</h2>\n<p>The medical focal point foresees 60 consultations/day for the first month. After it should increase. The medical focal point is requesting 3 new consultations for family planning, ante and post-natal care.</p>\n<h2>Infection control:</h2>\n<p>Apply the standard requirement for hygiene. There is no specific measure to take.</p>\n<h2>Type of facility:</h2>\n<p>Outpatient department, part of a health facility (inpatient department and a small maternity department). Both facilities are sharing the same compound. There is some space left on the compound at the entrance close to the OPD but really not much.</p>\n<h2>Ancillary and supportive services: </h2>\n<p>(After discussion with the medical focal point of my project) the women that will come can use the laboratory of the OPD. A space for dispensary will be necessary for drugs distribution, but it is not clear yet where it should be located. We will need to arrange a waiting area. Additional latrines will have to be built.</p>\n<h2>Investment choice:</h2>\n<p>(After discussion with my fieldco) the extension of the OPD should be ready within 6 months. This is not an emergency! This project has been presented in the AROs and we have a budget of XXX euros.</p>\n<h2>Timing of operation:</h2>\n<p>This is a 5 year project. We are now in the third year of it. This is a project by default, so the duration may extend depending of the situation.</p>\n<h2>Exit strategy:</h2>\n<p>This is an MSF stand-alone project. There is another organization present that is responsible for food distribution and nothing else. The project will close when the refugee situation is solved.</p>\n<h2>Setting (URBAN-RURAL-CAMP):</h2>\n<p>We are located in a camp in the bush. There is a small city 10 min drive away by car called Pipore. This is in South-Sudan. There are a lot of people in the camp but outside of it there is nobody.</p>\n<h2>Security (SAFE-UNSAFE-CONFLICT):</h2>\n<p>There is conflict in the country. The situation is unsafe in the camp. We can only walk around during the daytime apart from when we receive a special notification from the fieldco.</p>\n<h2>Access:</h2>\n<p>The roads are more tracks than road. Hopefully, our activities are set in the camp and so the beneficiaries can come by foot. When we go to the market in Pipore on Sundays, we go by car. But for the rest, everything is transported by plane.</p>\n<h2>Climate, season, geography and soil:</h2>\n<p>The rainy season lasts around 6 months and for the remaining time the climate is dry and hot, around 35°. The land is mostly flat with  the occasional big Baobab tree. The ground is very sandy and dusty, so when the wind blows the grains go everywhere. The Watson told me that the soil is comprised of a mixture of Clay and Laterite. The water table is also very high.</p>\n<h2>Local resources:</h2>\n<p>Everything is coming from Juba at the exception of some basic hygiene items and a bit of food that we can find locally. Small facilities and basic products (hygiene and food) are available in small quantities in the city.</p>\n<p>The refugees are under tents. But in Pibore, the house and the shops are made of mud bricks (which is good for this climate). A machine to create the bricks, is available in the other NGO camp (for food distribution). There are some stock wood, gravel and stone. My team is made of 3 logs, 1 log base (from Juba), 1 log tech (from Pibore) and me.</p>\n<h2>Cultural and societal appropriateness: </h2>\n<p>The staff told me the women are not mixed with men in the hospital. There are 2 waiting areas, but the consultation rooms in the OPD are the same for men and women. There is an average of 4 children per family!</p>\n<h2>Norms and regulations:</h2>\n<p>The authority leases us the OPD compound for free during the time of the activities. They want to have it back free from any construction at the end of the project. No foundations are allowed!</p>";
},"useData":true});

this["BestForMe"]["Templates"]["tutorials/pages/parameter-tutorial"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<h1>Parameter Guide Tutorial</h1>\n<h2>About the Paramater Guide</h2>\n<p>The parameter guide is the overview of the most important parameters to take into consideration by MSF LOGs when planning a project. LOG tactics are part of the ecosystem of MSF operations and as such, they should be seen as integrated with the project.</p>";
},"useData":true});

this["BestForMe"]["Templates"]["tutorials/pages/pathways-example"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<h1>Pathways Example</h1>\n<p>When relevant, the Example panel presents an example content type, to help you format your data. </p>\n";
},"useData":true});

this["BestForMe"]["Templates"]["tutorials/pages/pathways-tutorial"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<h1>Pathways Tutorial</h1>\n<h2>What is Pathways</h2>\n<p>Pathways is a sequence of steps that guide the tactician while developing a specific tactic</p>\n\n<h2>Why Pathways?</h2>\n<ul>\n  <li><strong>Empower</strong> the log tactician to give the best environment of care to our beneficiaries and our medical team activities.</li>\n  <li><strong>Reduce</strong> the gap between the experienced and novice log tacticians and allows qualitative solution within the operational framework.</li>\n</ul>\n\n<h2>When should I use it?</h2>\n<p>Starting a new project or when circumstances in the project have changed</p>";
},"useData":true});

this["BestForMe"]["Templates"]["tutorials/pages/project-tutorial"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<h1>Project Tutorial</h1>\n<h2>What is Pathways</h2>\n<p>Pathways is a sequence of steps that guide the tactician while developing a specific tactic</p>\n\n<h2>Why Pathways?</h2>\n<ul>\n  <li><strong>Empower</strong> the log tactician to give the best environment of care to our beneficiaries and our medical team activities.</li>\n  <li><strong>Reduce</strong> the gap between the experienced and novice log tacticians and allows qualitative solution within the operational framework.</li>\n</ul>\n\n<h2>When should I use it?</h2>\n<p>Starting a new project or when circumstances in the project have changed</p>\n\n<iframe src=\"https://player.vimeo.com/video/220484367\" width=\"465\" height=\"262\" frameborder=\"0\" webkitallowfullscreen mozallowfullscreen allowfullscreen></iframe>";
},"useData":true});

this["BestForMe"]["Templates"]["tutorials/pages/tactical-example"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<h1>Tactical specification Example</h1>\n<h2>Jackie in South-Sudan, Step 2: Tactical Specifications</h2>\n<h2>Tactical Family/ Activity Name:</h2>\n<p>As the type of facility is an out-patient department inside a health facility and as this is not an emergency, Jackie is selecting the <strong>Out-patient activities</strong> and the health facility (for memory, not mandatory) as tactical families.</p>\n<p>As the PMR told her, she has to build 2 new consultation rooms and foresee a space for vaccination, she is writing <strong>extension of the consultation rooms and vaccination.</strong> As the PMR told her (for the support services parameters), she has to implement as well a dispensary, a waiting area and additional latrines. She is filling a second tactical specifications guide for these additional operational needs.</p>\n<h2>Solution requirements:</h2>\n<p>As there is not much space available and the OPD is part of a bigger system (health facilities), Jackie is writing down that the solution must be <strong>integrated in a master plan</strong> to have a vision of future extension possibilities.</p>\n<p>As there are quite a lot of supportive services to implement, together with the 2 consultations, this does not leave much space left. In addition, culturally we should foresee gender separation therefore, she is writing the solution must fulfil a <strong>studied flow of staff and patients.</strong></p>\n<p>As the area can be flooded, Jackie is writing down the solution <strong>should be elevated.</strong> As the number of consultations may increase in the future. Jackie is writing <strong>Modular (possibility of extension).</strong> As it is not allowed by the owner of the compound, Jackie is writing <strong>without foundations.</strong></p>\n<p>As the project will be running for 2 more years, Jackie is writing the <strong>solution should stay good for 2 years and more.</strong></p>\n<p>It is a rural area, the roads are not in a good condition, the security on the roads is not good either, and during the rainy season the roads are not accessible anymore. Jackie is therefore writing down <strong>the solution should not depend on road access.</strong> As there is not much material for construction, Jackie is writing, <strong>material to be mostly imported.</strong></p>\n<h2>What Technical Families are implicated?</h2>\n<p>As it is requested to extend the consultation room, Jackie is selecting <strong>Infrastructures.</strong></p>\n<p>As she should work on the location of the new services based on the flow of the staff and the patient, but as well because a new extension may be requested later on, she is writing, <strong>HFM.</strong></p>\n<p>As water will be needed in the consultation and light, she is writing <strong>Watsan</strong> (plumbing) and <strong>Energy</strong> (electricity).</p>\n<p>As she has to implement vaccination activity, she is writing down <strong>Cold Chain.</strong></p>\n<h2>Other departments implicated:</h2>\n<p>As she has only one log tech in her team and she is not a specialist in construction herself, she is preparing a job description to <strong>recruit a constructor.</strong></p>\n<p>As there is not much material available for construction locally, she will request some support from the supply coordinator to organize the <strong>supply chain of the construction material</strong> on time.</p>\n<p>Role of external stakeholder: She is not sure, but there is another organization that has a machine forming mud bricks, perhaps she will need it, so she is writing down, ask if the machine could be available.</p>";
},"useData":true});

this["BestForMe"]["Templates"]["tutorials/pages/tactical-tutorial"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<h1>Tactical specification Tutorial</h1>\n\n<h2>Highly contagious disease outbreaks</h2>\n<p>Deployment and support of activities tackling diseases, which require to be contained with universal protection for patients and staff over the ordinary measures, with an imposed limited timeframe</p>\n<h2>Distributions</h2>\n<p>Deployment and support of activities aiming at immunization (preventive and curative), water access, shelter items and/or NFI distribution (protection, primary needs) for population coverage within a predefined execution timeframe </p>\n<h2>Medical activities in emergency</h2>\n<p>Deployment and support of first aid and primary needs activities with an imposed limited timeframe for implementation</p>\n<h2>Surgical activities in emergency</h2>\n<p>Deployment and support of surgical activities, with an imposed limited timeframe for implementation</p>\n<h2>Health facilities</h2>\n<p>Deployment and support of permanent hospitalization facilities with multiple services</p>\n<h2>Mobile medical activities</h2>\n<p>Deployment and support activities that imply a movement of staff and material aiming at reaching the beneficiaries in the place of need</p>\n <h2>Out-patient department activities</h2>\n<p>Deployment and support of ambulatory care activities aiming at population coverage</p>\n<h2>Vertical IPD activities</h2>\n<p>Deployment and support of specialized hospitalization facilities aiming at treating a specific disease</p>\n<h2>Medical activities in restricted area</h2>\n <p>Deployment and support of public health activities and/or consultations inside areas with controlled access or movement</p>";
},"useData":true});

this["BestForMe"]["Templates"]["tutorials/tutorial-view"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<section class=\"page-tutorial cbp-spmenu cbp-spmenu-vertical cbp-spmenu-left\" id=\"cbp-spmenu-s1\">\n  <h1>Tutorial</h1>\n  <ul id=\"header-nav\">\n      <li class=\"main-nav-item btn\">\n        <a id='tutorial-link' class=\"main-nav-link\">\n          <span class=\"main-nav-link-title\">Tutorial</span>\n        </a>\n      </li>\n    <li class=\"main-nav-item btn\">\n      <a id='example-link' class=\"main-nav-link\">\n        <span class=\"main-nav-link-title\">Example</span>\n      </a>\n    </li>\n  </ul>\n\n  <section id=\"page-tutorial\">\n\n  </section>\n\n  <section id=\"page-example\">\n\n  </section>\n\n  <div class=\"close-button\">\n    <button id=\"close-tutorial\" class=\"button\"></button>\n  </div>\n</section>";
},"useData":true});;/**********************************************************************************/
/*  Authentification Module that manages user login/token
/**********************************************************************************/

BestForMe.Authentification = Backbone.Marionette.Object.extend({

  // store in authData object all the data that need to be shared with auth code (auth controller + login screen) [to reduce init boilerplate code]
  authData: null,

  // appData needed for the error handler mixin
  // also contains token and tokenBearerHeader (XHR request header)
  appData: null,

  // headers for acquire token XHR requests
  // Header  with Authorization Basic base64(clientId:clientSecret) + Content-Type
  acquireTokenHeaderWithClientCredentials: null,
  // Header  with Content-Type only
  acquireTokenHeaderContentTypeOnly : null,

  // Backbone auth radio channel
  // required for messaging between modules/views who don't have a direct reference to auth, so can't directly listen to events on it
  authChannel: null,

  // Backbone data radio channel
  // Data Manager uses it to broadcast a message that all data (tags, categories, quizzes, cases) have been retrieved, or there was an error
  dataChannel: null,

  // if the user wants to stay logged in, save the token in local storage so it can be retrieved at next session
  // only save the toke, not the user login proper
  // otherwise, do nothing, the backbone models will only be available locally until the user reloads
  // rememberMe option is set by user on login screen, and sent in user:login event
  rememberMe: false,

  // to differentiate between initial auth on app launch, and token update requested by module data managers later on
  initialAuthCompleted: false,

  // if several module data managers request token update at the same time, update only once
  tokenUpdateInProgress: false,

  // synced storage manager: hybrid of localStorage and sessionStorage
  // enables user to stay logged in accross tabs and on tab refresh
  syncedStorageManager: null,

  // holds a model for 2 steps of password reset
  // !!! important to set to null as soon as request completed as we really on testing for these variable to know which step is in progress in the event chain
  // Step 1: get a password reset key
  passwordResetRequest: null,
  // Step 2: password reset proper
  passwordReset: null,


/* --- Initialisation code: init data passed from root app  --- */

  initialize: function(config) {

    this.authData = config.authData;
    this.appData = config.appData;

    // login view explicitely sends a user:login event
    // because listening to change event on login model does work when a login happens after a server error, even though it works fine on initial login
    this.authChannel = Backbone.Radio.channel('auth');
    this.listenTo(this.authChannel, 'user:login', this.onUserLogin);
    // sent by module data managers when they detect the token as experired before attempting a data request
    this.listenTo(this.authChannel, 'request:token:update', this.onTokenUpdateRequested);
    // non logged-in user requests a password reset from the login screen
    this.listenTo(this.authChannel, 'request:password:reset', this.onRequestPasswordReset);
    // non logged-in user resets their password after the request above was successful
    this.listenTo(this.authChannel, 'reset:password', this.onResetPassword);
    // logged-in user changes their password via their profile screen
    this.listenTo(this.authChannel, 'change:password', this.onChangePassword);

    // data fetch error is sent by data manager when there was a XHR error fetching data
    // in that case we need to clear the login/token and log in from scratch
    this.dataChannel = Backbone.Radio.channel('data');
    this.listenTo(this.dataChannel, 'data:fetch:error', this.onDataFetchError);

    // init acquire token XHR header form client credentials
    this.initAcquireTokenHeader();

    // init token
    this.initToken();

    // init synced storage manager
    this.initSyncedStorageManager();
  },

  initAcquireTokenHeader: function () {

    var clientAuthBase64 = window.btoa(this.authData.clientCredentials.get('clientId')+':'+this.authData.clientCredentials.get('clientSecret'));

    this.acquireTokenHeaderWithClientCredentials = {
      'Authorization' :'Basic '+clientAuthBase64,
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    this.acquireTokenHeaderContentTypeOnly = {
      'Content-Type': 'application/x-www-form-urlencoded'
    };
  },

  initToken: function() {

    // create token with server url
    this.appData.token = new BestForMe.Token(
      null,
      { url: this.authData.tokenEndpoint }
    );
  },

  // Clear login and token on log out or whenever there is a server error
  clearLoginAndToken: function() {

    console.log('Authentification.clearLoginAndToken rememberMe: '+this.rememberMe);

    // clear the values locally
    this.authData.login.clear();
    this.appData.token.clear();
    // also clear the XHR header using the token
    this.appData.tokenBearerHeader = null;

    // if the user had chosen to stay logged in, clear the flag
    if (this.rememberMe) {
      this.rememberMe = false;
    }
    // in either case, delete the saved token
    // the sync storage library detects itself whether the token is in permanent store or synced session store
    this.syncedStorageManager.deleteData('token');
  },

  // Clear the temporary token used to reset the password when a user is not logged in
  clearTemporararyToken: function() {

    // clear the values locally
    this.appData.token.clear();
    // also clear the XHR header using the token
    this.appData.tokenBearerHeader = null;
  },

  // synced storage manager: hybrid of localStorage and sessionStorage
  // enables user to stay logged in accross tabs and on tab refresh
  initSyncedStorageManager: function() {

    this.syncedStorageManager = new BestForMe.LocalStoreManager();

    // sync auth accross tabs
    // syncedStorageManager dispatches a custom event when the session storage has been updated
    // session storage does not trigger 'storage' events itself on the tab that updated the session storage, contrary to local storage
    // (there would be a storage event on for example an iframe sharing the session storage though)
    // need to use a plain JS event listener as the backone 'listenTo' can only listen to backbone objects 'trigger'
    var me = this;
    // MM: the function needs to be named in order to be able to unbind it
    var onSyncedStorageSet = function (e) { 
      me.onSyncedStorageSet(e);
    };
    window.addEventListener('sessionStorageSet', onSyncedStorageSet, false);


    // listen when token is deleted, to sync logout accross tabs
    // otherwise log out in 1 tab gets only picked up by another tab on refresh or if token expires
    // a tab can't listen for custom event fired in another tab
    // so we have to listen for one of the storage events used internally by syncedStorageManager
    // the one to delete data, regardless of whether data was in synced session or local storage is identified by:
    // key = removeFromSessionStorage" && newValue = null && oldValue = "token"
    // MM: the function needs to be named in order to be able to unbind it
    var onSyncedStorageDeleted = function (e) { 
      me.onSyncedStorageDeleted(e);
    };
    window.addEventListener('storage', onSyncedStorageDeleted, false);

    this.syncedStorageManager.initialiseStorageSyncListener();
  },

  // manually unbind the plain JS events on destroy, as only backbone events are automatically cleaned up
  onBeforeDestroy: function(){
    window.removeEventListener('sessionStorageSet', onSyncedStorageSet, false);
    window.removeEventListener('storage', onSyncedStorageDeleted, false);
  },


/* --- Start code: init sequence starts when root app starts  --- */

  start: function() {

    // first see if token stored in local storage
    this.getTokenFromLocalStorage();
  },

/* --- Interfacing with syncedStorageManager via custom events  --- */

  // syncedStorageManager dispatches a custom event when the session storage has been updated
  // session storage does not trigger 'storage' events itself on the tab that updated the session storage, contrary to local storage
  // MM WARNING: this gets triggered more than once if you have more than 2 tabs open, however it gets acted on only once due to flag
  // I did what I could to unbind everything so I dont think it's a memory leak
  // I think the local store manager triggers the event for some internal storage moves it does, not just when it stores the token
  onSyncedStorageSet: function(e) {

    console.log('TRIGGERED Authentification.onSyncedStorageSet: '+JSON.stringify(e.detail));
    // if a token has been put in session storage, retrieve it for this tab
    // MM: test that auth is not already completed, for the special case of reloading on a 'secondary tab' with remember me unchecked
    // if we don't check, token is retrieved from secondary tab's own session storage (from initial load of secondary tab), then loaded again after synced storage
    // also if you have multiple tabs open, the event will be fired once by each
    if (!this.initialAuthCompleted && _.indexOf(e.detail, 'token') > -1) {
      console.log('ACTED ON Authentification.onSyncedStorageSet: '+JSON.stringify(e.detail));
      this.getTokenFromLocalStorage();
    }   
  },

  // listen when token is deleted, to sync logout accross tabs
  // otherwise log out in one tab gets only picked up by another tab on refresh or if token expires
  onSyncedStorageDeleted: function(e) {

    // MM: this.initialAuthCompleted keeps track whether we're curently logged in or not (in this tab)
    // the log out event below will set it to false
    // we need to test for it otherwise there is an endless event loop of:
    // log out in other tab -> storage envent in this tab -> log out in this tab -> storage event in this tab -> endless log out loop in this tab
    if (this.initialAuthCompleted && e.key === 'removeFromSessionStorage' && e.newValue === null && e.oldValue === 'token') {
      console.log('Authentification.onSyncedStorageDeleted: '+e.key+' '+e.oldValue);
      // MM: trigger a logout the same way the logout button would. 
      // we do not do this.onLogOut directly because the main app picks up the logout event and will trigger onLogOut on auth, along with logout actions on other modules
      this.authChannel.trigger('log:out');
    }
  },

/* --- Get token from localStorage  --- */

  getTokenFromLocalStorage: function() {

    console.log('Authentification.getTokenFromLocalStorage');

    // new version with synced local store
    var savedToken = this.syncedStorageManager.getData('token');
    console.log('TOKEN FETCHED FROM LOCAL STORE');
    console.log(savedToken);

    if (savedToken) {

      // set the token model to the retrieved data
      this.appData.token.set(JSON.parse(savedToken));

      // if a token was found in local storage, set rememberMe = true
      // the flag would not have been set if user did not go through login screen this session
      // but implicit from last session since token was stored.
      this.rememberMe = true;

      // check whether token is still valid or needs refreshing
      if (this.appData.token.isValid()) {

        console.log('Authentification.tokenFetchSuccessFomLocalStorage VALID model: '+JSON.stringify(this.appData.token));
        // token valid: use the token in the XHR header of all subsequent requests
        this.completeAuthentification();
      }
      else {

        console.log('Authentification.tokenFetchSuccessFomLocalStorage INVALID REFRESH model: '+JSON.stringify(this.appData.token));
        // token expired: try to refresh it
        this.requestTokenFomServer("refresh", this.appData.token);
      }
    }
    else {
      // if no token was found in local storage, send a message to the root app that the user needs to log in
      // so the root app tells the router to display the login screen
      this.authChannel.trigger('login:required');
    }
  },


/* --- Authentification sequence starts back from here if we went off to the login screen  --- */

  // the login screen updates the login model
  // the auth module listen to changes on the login model and triggers onUserLogin
  onUserLogin: function(rememberMe) {

    console.log('Authentification.onUserLogin username: '+this.authData.login.get('username')+', password : '+this.authData.login.get('password')+' rememberMe: '+rememberMe);

    // save user choice of staying logged in accross sessions or not
    this.rememberMe = rememberMe;

    // request brand new token form server with the user login
    this.requestTokenFomServer("password");
  },

/* --- Triggered by module data managers when they detect the token as expired before attempting a data request  --- */

  onTokenUpdateRequested: function() {

    console.log('Authentification.onTokenUpdateRequested tokenUpdateInProgress: '+this.tokenUpdateInProgress);

    // if several module data managers request token update at the same time, update only once
    if (!this.tokenUpdateInProgress) {

      this.tokenUpdateInProgress = true;
      // token expired: try to refresh it
      this.requestTokenFomServer("refresh", this.appData.token);
    }   
  },

/* --- Get token from server  --- */

  // request brand new token from server, or refresh expired token
  // requestType: password / clientCredentials / refresh
  // token: only needed for requestType = refresh
  // We arrive here after:
  //   - either user just logged in
  //   - or login was found in local storage but either no token was found in local storage, or it has expired
  requestTokenFomServer: function(requestType, token) {

    console.log('Authentification.requestTokenFomServer requestType: '+requestType+', token : '+token);

    // capture 'this' for callbacks
    var me = this;

    var grantType = '';
    var header = null;

    // request new token with username/password
    if (requestType === "password") {

      var username = encodeURIComponent(this.authData.login.get('username'));
      var password = encodeURIComponent(this.authData.login.get('password'));

      grantType = 'grant_type=password&username='+username+'&password='+password;
      header = me.acquireTokenHeaderWithClientCredentials;
    }
    // request new token with app client credentials
    // we only do this before resetting the user password
    else if (requestType === "clientCredentials") {

      grantType = 'grant_type=client_credentials&client_id='+this.authData.clientCredentials.get("clientId")+'&client_secret='+this.authData.clientCredentials.get("clientSecret");
      header = me.acquireTokenHeaderContentTypeOnly;
    }
    // refresh expired token
    else if (requestType === "refresh") {

      if (token === null || token === undefined) {
        console.log('ERROR authentification.requestTokenFomServer TRYING TO REFRESH A TOKEN of type: '+token);
      }
      else {

        grantType = 'grant_type=refresh_token&refresh_token='+token.get("refreshToken")+'&client_id='+this.authData.clientCredentials.get("clientId")+'&client_secret='+this.authData.clientCredentials.get("clientSecret");
        header = me.acquireTokenHeaderContentTypeOnly;
      }
    }
    // Probably no need for further error handling since only our internal code could cause such an error, just dev hint needed
    else {
      console.log('ERROR authentification.requestTokenFomServer INVALID REQUEST TYPE: '+requestType);
    }

    // ajaxSync: true to get token from server and bypass backbone.localstorage for this request
    this.appData.token.fetch({
      ajaxSync: true,
      success: function(model, response, options) {
        me.tokenFetchSuccessFomServer(model, response, options, requestType, token);
      },
      error: function(model, response, options) {
        me.tokenFetchErrorFomServer(model, response, options, requestType, token);
      },
      method: 'POST',
      headers: header,
      data: grantType
    });
  },

  tokenFetchSuccessFomServer: function(model, response, options, requestType, token) {

    console.log('Authentification.tokenFetchSuccessFomServer requestType: '+requestType+' model: '+JSON.stringify(model)+', response: '+JSON.stringify(response));

    // general case of a token obtained from user login, either brand new or refreshed
    if (requestType === "password" || requestType === "refresh") {

      // if the user has chosen to stay logged in, save token in permanent data, will be available accross tabs AND on next relaunch
      var tokenJSON = JSON.stringify(this.appData.token.toJSON());
      console.log(tokenJSON);
      if (this.rememberMe) {
        this.syncedStorageManager.savePermanentData(tokenJSON, 'token');
      }
      // else save token in synced session data, token will be available across tabs and on reload but cleared when all tabs are closed
      else {
        this.syncedStorageManager.saveSyncedSessionData(tokenJSON, 'token');
      }

      // use the token in the XHR header of all subsequent requests
      this.completeAuthentification();

    }
    // special case of a token acquired from app client credentials, in order to reset the user password
    // this happens in 2 steps with most likely a separate app reload in between because user does 2nd step from an email link
    // so each step needs its separate temporary token
    // !!! the temporary token is not saved, it is just used to reset the password then cleared
    // !!! we don't want a non logged in user to hikack the temp token to try and do something else by typing a direct link
    else if (requestType === "clientCredentials") {

      // make temporary token bearer header used in reset password XHR request
      this.appData.tokenBearerHeader = {
        'Authorization' :'Bearer '+this.appData.token.get('accessToken')
      };

      // we identify which step based on which model is waiting to be sent
      // Step 1: request a password reset key
      if (this.passwordResetRequest) {
        this.requestPasswordReset();
      }
      // Step 2: password reset proper
      else if(this.passwordReset) {
        this.resetPassword();
      }
    }
  },

  tokenFetchErrorFomServer: function(model, response, options, requestType, token) {

    console.log('Authentification.tokenFetchErrorFomServer requestType: '+requestType+' model: '+JSON.stringify(model)+', response: '+JSON.stringify(response)+', options: '+JSON.stringify(options));

    // handleError method is on ErrorHandlerMixin
    // defaultAction = false -> tell the error handler not to process the action itself 
    var formattedError = this.handleError(response, options, false);

    // clear all login and token both locally and in local storage
    this.clearLoginAndToken();

    // emit an event telling the login is invalid
    this.authChannel.trigger('login:invalid', formattedError.errorMessage);
  },


/* --- Complete authentification sequence and pass back to the main app  --- */

  completeAuthentification: function() {

    this.appData.tokenBearerHeader = {
      'Authorization' :'Bearer '+this.appData.token.get('accessToken')
    };
    console.log(this.appData.tokenBearerHeader);

    // token was fetched for initial auth on app launch
    if (!this.initialAuthCompleted) {

      // flag that initial auth has now been completed
      this.initialAuthCompleted = true;
      // emit an event telling the root app authentification is finished so that it can fetch the main data
      this.authChannel.trigger('authentification:complete');

    }
    // else and token update requested by module data managers later on
    else {

      // clear in progress flag
      this.tokenUpdateInProgress = false;
      // emit an event telling the module data managers that the token has been updated
      this.authChannel.trigger('token:updated');
    } 
  },


/* --- Code when data manager encounters a data fetch error  --- */

  // data fetch error is sent by data manager when there was a XHR error fetching data
  onDataFetchError: function(formattedError) {

    console.log('Authentification.onDataFetchError: '+JSON.stringify(formattedError));

    // clear local values and prevent accumulation of wrong logins in local storage
    // only if the error had to do with expired token
    // due to varied error codes, it's best to test whether the action is to go to login screen
    if (formattedError.action === 'login') {
      this.clearLoginAndToken();
    }
  },

/* --- Log out --- */

  // called by main app after user logs out
  // do not catch the logout event directly because main app needs to control order of data clearing happening in auth and data manager
  onLogOut: function() {

    console.log('Authentification.onLogOut');

    // clear all login and token both locally and in local storage
    this.clearLoginAndToken();
    // mark the authentification need to be done again from scratch
    this.initialAuthCompleted = false;
  },


/* --- Reset and Change Password --- */

/* - non logged-in user asked to reset their password from the login screen - */

  onRequestPasswordReset: function(username) {

    console.log('Authentification.onResetPassword username: '+username);

    // create the model that will be sent to server at next step (after temp token is aquired)
    this.passwordResetRequest = new BestForMe.PasswordResetRequest(
      {
        identifier: username
      },
      {
        userBaseUrl: this.authData.userEndpoint
      }
    );

    // request a token using only the app client credentials
    this.requestTokenFomServer("clientCredentials");
  },

  // we arrive at this step if the server request for a token based app client credentials was successful
  requestPasswordReset: function() {

    // capture 'this' for callbacks
    var me = this;

    // POST request to server
    this.passwordResetRequest.save(
      null,
      {
        headers: this.appData.tokenBearerHeader,
        success: function (model, response, options) {
          me.requestPasswordResetSuccess(model, response, options);
        },
        error: function (model, response, options) {
          me.requestPasswordResetError(model, response, options);
        }
      }
    );
  },

  requestPasswordResetSuccess: function(model, response, options) {
    console.log('Authentification.passwordResetSuccess MODEL '+JSON.stringify(model));
    console.log('Authentification.passwordResetSuccess RESPONSE '+JSON.stringify(response));

    // clear the local variable used to store the model for the duration of the event sequence
    this.passwordResetRequest = null;
    // clear the token acquired with the app client credentials only
    this.clearTemporararyToken();

    // display user instructions in alert box
    swal("Success", "An email has been sent to the email address associated with your username. Please follow the instructions to reset your password and log in with the new password.");

    // send event caught by login screen, so it displays a message telling user to check their email
    this.authChannel.trigger('request:password:reset:success');
  },

  requestPasswordResetError: function (model, response, options) {
    console.log('Authentification.passwordResetError MODEL '+JSON.stringify(model));
    console.log('Authentification.passwordResetError RESPONSE '+JSON.stringify(response));

    // clear the local variable used to store the model for the duration of the event sequence
    this.passwordResetRequest = null;
    // clear the token acquired with the app client credentials only
    this.clearTemporararyToken();

    // tell the login screen to display the error message
    // handleError method is on ErrorHandlerMixin
    // defaultAction = false -> tell the error handler not to process the action itself 
    var formattedError = this.handleError(response, options, false);

    // display error message in alert box
    swal(errorMessage);

    this.authChannel.trigger('request:password:reset:error', formattedError.errorMessage);
  },

/* - non logged-in user resets their password - */
/* after a request password reset above was succesful and provided them with a reset key
/* they get to this second step of resetting their password proper via an email link
/* so the webapp is loaded from scratch, and we need to get the temporary token again
/**/

  onResetPassword: function(newPassword) {

    // case where the app was unable to pick up the reset key from the url, for example the user tried to reset from an incomplete url
    if (!this.authData.passwordReset || !this.authData.passwordReset.username || !this.authData.passwordReset.key) {
      // take the user to the login screen so they can request a new reset key
      swal({
        title: "The password reset link is invalid or incomplete. Please check the link in the email you received, or request a new one using the 'Forgotten Password?' link.",
        showCancelButton: false,
        confirmButtonText: "OK",
        closeOnConfirm: true
      },
      function(){
        var routerChannel = Backbone.Radio.channel('router');
        routerChannel.trigger('navigate:to:page', 'login');
      });
      return;
    }

    // create the model that will be sent to server at next step (after temp token is aquired)
    this.passwordReset = new BestForMe.PasswordReset(
      {
        password: newPassword,
        // the username and reset key were picked up from the url of the custom password reset link
        username:  this.authData.passwordReset.username.replace('+', ' '),      
        resetKey: this.authData.passwordReset.key
      },
      {
        url: this.authData.passwordEndpoint
      }
    );

    // request a token using only the app client credentials
    this.requestTokenFomServer("clientCredentials");
  },

  // we arrive at this second step if the first step above of server request for a token based app client credentials was successful
  resetPassword: function(newPassword) {

    var me = this;
    // Performs a PUT request to change the user password
    this.passwordReset.save(
      null,
      {
        headers: this.appData.tokenBearerHeader,
        success: function (model, response, options) {
          me.resetPasswordSuccess(model, response, options);
        },
        error: function (model, response, options) {
          me.resetPasswordError(model, response, options);
        }
      }
    );
  },

  // If password change is successful, inform the user
  resetPasswordSuccess: function() {

    // clear the rest pasword key since we have used it
    this.authData.passwordReset = null;
    // clear the local variable used to store the model for the duration of the event sequence
    this.passwordReset = null;
    // clear the token acquired with the app client credentials only
    this.clearTemporararyToken();

    swal({
        title: "Your password has been changed successfully. Please log in.",
        showCancelButton: false,
        confirmButtonText: "OK",
        closeOnConfirm: true
      },
      function(){
        // MM: the user navigated to the password reset screen from their email link
        // to allow, the reset request, we used a temporary token based on app credentials
        // before allowing the user to go further, we want them to log in and get a proper token
        // also tell the app to clear the redirect to password reset
        var authChannel = Backbone.Radio.channel('auth');
        authChannel.trigger('password:reset:clear:redirect');
      });
  },

  // If password change has failed, inform the user
  resetPasswordError: function() {

    // clear the rest pasword key since it did not work, so is likely expired or wrong
    this.authData.passwordReset = null;
    // clear the local variable used to store the model for the duration of the event sequence
    this.passwordReset = null;
    // clear the token acquired with the app client credentials only
    this.clearTemporararyToken();

    // take the user to the login screen so they can request a new reset key
    swal({
        title: "An error occurred changing your password. Most likely the change password link was no longer valid. Please request a new one using the 'Forgotten Password?' link.",
        showCancelButton: false,
        confirmButtonText: "OK",
        closeOnConfirm: true
      },
      function(){
        // take the iuser back to login screen so they can request a fresh key
        // also tell the app to clear the redirect to password reset since we're starting the whole process from scratch
        var authChannel = Backbone.Radio.channel('auth');
        authChannel.trigger('password:reset:clear:redirect');
      });
  },

  /* - logged-in user changes their password - */

  onChangePassword: function(passwordChangeData) {

    var passwordChange = new BestForMe.PasswordChange(
      {
        oldPassword: passwordChangeData.oldPassword,
        password: passwordChangeData.password
      },
      {
        url: this.authData.passwordEndpoint
      }
    );

    var me = this;
    // Performs a PUT request to change the user password
    passwordChange.save(
      null,
      {
        headers: this.appData.tokenBearerHeader,
        success: function (model, response, options) {
          me.changePasswordSuccess(model, response, options);
        },
        error: function (model, response, options) {
          me.changePasswordError(model, response, options);
        }
      }
    );
  },

  // If password change is successful, inform the user
  changePasswordSuccess: function() {
    swal({
        title: "Your password has been changed successfully",
        showCancelButton: false,
        confirmButtonText: "OK",
        closeOnConfirm: true
      },
      function(){
        var routerChannel = Backbone.Radio.channel('router');
        routerChannel.trigger('navigate:to:page', 'home');
      });
  },

  // If password change has failed, inform the user
  changePasswordError: function() {
    swal("An error occurred changing your password, please ensure you details are correct and try again");
  }

});

// Copy the errorHandler mixin methods to BestForMe.Authentification
_.extend(BestForMe.Authentification.prototype, BestForMe.ErrorHandlerMixin);
;BestForMe.Router = Backbone.Marionette.AppRouter.extend({

  appRoutes: {
    // this is a temp screen with the BestForMe header but a spinning wheel in the main content view
    // this view show in the grey area time when the login is complete but the data has not been fetched yet
    'loading(/)': 'showLoadingScreen',
    // these 5 top level routes are triggered by nav bar buttons (or user bookmarked them)
    'home(/)': 'showHomeScreen',
    // root screen is home screen
    '(/)': 'showHomeScreen',
    // error screen if server error,
    'error(/)(:errorCode)': 'showErrorScreen',
    // parameters nested in a project
    'parameter-guide/:projectId': 'showParameterScreen',
    // tactical specification nested in a project
    'tactical-specification/:projectId': 'showTacticalScreen',
    // agility matrix nested in a project
    'agility-matrix/:projectId/:operationalNeedId': 'showSolutionScreen',
    // technical solution library nested in a project
    'technical-solution-library/:projectId/:operationalNeedId': 'showSolutionScreen',
    // tactical canvas nested in a project
    'tactical-canvas/:projectId/:operationalNeedId': 'showCanvasScreen',
    // final tactic nested in a project
    'final-tactic/:projectId/:operationalNeedId': 'showTacticScreen',
    // export parameters in a printer friendly view
    'export-parameters/:projectId': 'showParameterExport',
    // export operational needs in a printer friendly view
    'export-operational-need/:projectId': 'showOperationalNeedExport',
    // export final canvas in a printer friendly view
    'export-final-tactic/:projectId/:operationalNeedId': 'showFinalTacticExport',
    // error screen if page not found
    // call it ourselves
    'pagenotfound(/)': 'showPageNotFound',
    // or the user types wrong link in navbar of link contains non-existent route
    '*path'  : 'showPageNotFound'
  },

  // keep track whether the app core data has been fetched
  // this is to handle the case when the user is trying to reload on a specific view, we need to fetche the wqit and wait before rendering the view
  appDataFetched: false,

  // list all the routes that are allowed before data is fetched
  // MM: !!! in execute method 'name' is not the name of the route but the name of the callback method!!! so test on it
  routesAllowedBeforeDataFetched: [
    'showLoadingScreen',
    'showErrorScreen',
    'showPageNotFound'
    // leven in local mode, we need the time to read the JSON files becaaue the home screen needs the projects and the nested parameters
    //'showHomeScreen'
  ],

  // Backbone router radio channel
  // to tell the main app a route has not been blocked, so it's OK to clear the redirect
  routerChannel: null,

  // to allow previously blocked route if loading screen times out, so we don't stay stuck on it
  allowBlockedRoute: false,

  // router stores parameters of a blocked route, so it can execute it later if allowBlockedRoute flag above is set
  blockedRoute: null,

  // appData, to access rootHomePage
  appData: null,

  // 'smart history' for internal back button logic
  // to keep track whether the user landed on the current page directly (from external link/bookmark)
  smartHistory: {
    previousPage: null,
    currentPage: null
  },

  initialize: function(config) {

    // appData, to access appData.rootHomePage
    this.appData = config.appData;

    // previous page for internal back button logic, init to app homepage
    this.smartHistory.previousPage = this.appData.rootHomePage;

    // radio channel used by views to trigger navigation to a different route
    this.routerChannel = Backbone.Radio.channel('router');

    // either loading screen notifies it has timed out, or the main app couldn't load core data
    // either way, navigate to empty content screen (on which the user can reload) and display an error message
    this.listenTo(this.routerChannel, 'server:down', this.onServerDown);
    // internal back button logic from views
    // MM: put this functionality in BestForMe even though it's currently used in Capsule only
    this.listenTo(this.routerChannel, 'go:back', this.goBack);
  },

  // called directly main app when app core data has been fetched
  // from then on, it's OK to navigate to content views
  // needs to be called by main itself when it catched the event from data controller rather than wait for router to catch event in its own time
  // because staight after the main app will try to navigate to content view, so navigation needs to be unlocked in router.
  onDataFetched: function() {
    console.log('Router.onDataFetched ADD DATA FETCHED!!!!');
    this.appDataFetched = true;
  },

  // either loading screen notifies it has timed out, or the main app couldn't load core data
  // either way, navigate to empty content screen (on which the user can reload) and display an error message
  onServerDown: function() {

    console.log('App.onServerDown, blockedRoute: '+JSON.stringify(this.blockedRoute));
    // MM: if the app stays stuck on the loading screen because of server error
    // we want to go the the desired page (which will be empty) so that the url in the navbar is correct
    // and show an alert message teling the user to wait a bit and try reload
    // this is why the url must be the desired one, so they don't reload on an error page

    // tell the excute function to exceptionally allow blocked route once, next time it executes
    this.allowBlockedRoute = true;

    // if a route was previously blocked, navigate to it
    if (this.blockedRoute) {

      // MM: don't do directly this.execute as it shows the view but does not change the url
      // map the route name to the url, and call this.navigate
      var routeUrl = this.routeUrlFromRouteMethod(this.blockedRoute.name, this.blockedRoute.args);
      this.navigate(routeUrl, {trigger: true});

      // clear the saved route since we're now executing it
      this.blockedRoute = null;
    }
    // else navigate to home by default
    else {
      this.navigate(this.appData.rootHomePage, {trigger: true});
    }

  },

  // method is called internally within the router, whenever a route matches and its corresponding callback is about to be executed
  // Return false from execute to cancel the current transition.
  // MM: !!! 'name' is not the name of the route but the name of the callback method!!! so test on it
  execute: function(callback, args, name, test) {
    console.log('Router.execute name: '+name+', args: '+JSON.stringify(args)+', allowBlockedRoute: '+this.allowBlockedRoute);

    // if data has not been fetched, check whether the route is allowed or block it otherwise
    if (!this.appDataFetched) {

      var routeAllowed = false;
      for (var i=0; i<this.routesAllowedBeforeDataFetched.length; i++) {
        if (name.match(this.routesAllowedBeforeDataFetched[i])) {
          routeAllowed = true;
          console.log('Router.execute ROUTE ALLOWED BEFORE DATA FETCHED!!!! name: '+name);
          break;
        }
      }

      // route is not allowed without appData, and we don't exceptionally allow it after loading timeout
      if (!routeAllowed && !this.allowBlockedRoute) {
        console.log('Router.execute  NO DATA CANCEL ROUTE!!!! name: '+name);

        // store parameters of a blocked route, so we can execute it later if allowBlockedRoute flag is set
        this.blockedRoute = {};
        this.blockedRoute.args = args;
        this.blockedRoute.name = name;

        // returning false prevents the route from executing
        return false;

      }
      // route is not allowed without appData, but we exceptionally allow it (with empty content) 
      // because the server could not be reached and we don't want to show the loading indicator forever
      else if (!routeAllowed && this.allowBlockedRoute) {

        // blocked Routes are allowed once by once, clear flag after allowing this once
        this.allowBlockedRoute = false;

      }
      // else route is allowed, just let execute as default

    }
    // appData has been fetched so routes are no longer blocked, clear any stored blocked route
    else if (this.blockedRoute) {
      this.blockedRoute = null;
    }

    if (callback) callback.apply(this, args);
  },

  // called direcly by the router, not router controller
  // from console log, it seems to happen after the router controller method
  onRoute: function(name, path, args) {
    $(document).scrollTop(0);
    console.log('Router.onRoute name: '+name+', path: '+path+', args: '+JSON.stringify(args));

    // format the route Url
    var routeUrl = this.routeUrlFromRouteMethod(name, args);

    // update the previous page for internal back button logic if user is navigating to a meaningful content page (not loading or loading screen)
    // otherwise previousPage should remain app homepage for the purpose of internal back button logic
    if (!path.match(/loading/) && !path.match(/login/)) {

      if (this.smartHistory.currentPage) {
        this.smartHistory.previousPage = this.smartHistory.currentPage;
      }
      this.smartHistory.currentPage = routeUrl;
    }

    // route url returned as regexp because of the article category/subcategory case (no way to know which from router method)
    var routeMatch = this.routeRegexpFromRouteMethod(name, args);

    // tell the main app the route has executed
    this.routerChannel.trigger('route:executed', routeMatch);
  },

  // Utility function: make route regexp from route method
  routeRegexpFromRouteMethod: function(name, args) {

    // make routeName in url slug format
    var routeName = '';
    if (name === 'showLoadingScreen') {
      routeName = 'loading';
    }
    else if (name === 'showHomeScreen') {
      routeName = 'home';
    }
    else if (name === 'showErrorScreen') {
      routeName = 'error';
      if (args[0]) {
        routeName += '\/'+args[0];
      }
    }
    else if (name === 'showPageNotFound') {
      routeName = 'pagenotfound';
    }
    // make the routeName into a regexpt because of the category/subcategory special case
    var routeRegexp = new RegExp(routeName, 'i'); 

    return routeRegexp;
  },

  // Utility function: make route url from route method
  // for articles categrory/subcategory, assume category by default since we have no way to know what the original url was
  // the difference is just for the CMS/taxonomy, the view is the same so treating a subcategory as a category will render fine
  routeUrlFromRouteMethod: function(name, args) {

    // make routeName in url slug format
    var routeName = '';
    if (name === 'showLoadingScreen') {
      routeName = 'loading';
    }
    else if (name === 'showHomeScreen') {
      routeName = 'home';
    }
    else if (name === 'showErrorScreen') {
      routeName = 'error';
      if (args[0]) {
        routeName += '/'+args[0];
      }
    }
    else if (name === 'showPageNotFound') {
      routeName = 'pagenotfound';
    }

    return routeName;
  }

});
;/**********************************************************************************/
/*  Top level Controller, works at same level as router.
/*  At first I had put these functions directly on the application but then you could not pass them to the router
/**********************************************************************************/

BestForMe.RouterController = Backbone.Marionette.Object.extend({

  // main app passes data to router controller
  // authData needed for login screen
  authData: null,
  // appData for all other screens
  appData: null,

  // keep track whether app layout has been rendered, when navigating between sub-sections
  appLayoutRendered: false,

  // keep track whether login screen is already being shown
  // needed to differentiate going back to it after failed login, or initial show
  loginScreenShown: false,

  // Backbone router radio channel
  // used to tell the header which landing page should be active in the nav
  routerChannel: null,

/* --- Initialisation code: init modules and pass them the data they need  --- */

  initialize: function(config) {

    // main app passes data to router controller
    // authData needed for login screen
    // appData for all other screens
    this.authData = config.authData;
    this.appData = config.appData;

    // radio channel used to tell the header which landing page should be active in the nav
    this.routerChannel = Backbone.Radio.channel('router');

    // init applayout since it may be used by several routes
    this.appLayout = new BestForMe.AppLayout({
      appData: this.appData
    });

    // init login screen on init rather than just before showing it because it may be redirected to a few times if invalid
    this.loginScreen = new BestForMe.LoginScreen({
      model: this.authData.login,
      title: this.appData.title
    });
  },


/* --- Show top views ( app layout or login screen) based on routing  --- */

  // show log in screen
  showLoginScreen: function() {

    // needed for special case of user reloading on #someroute and it gets redirected to login screen
    this.appLayoutRendered = false;

    console.log('RouterController.showLoginScreen');

    this.loginScreenShown = true;
    this.loginScreen.render();
  },

  // called by top app the first time we navigate to app screen
  // despite the 'isRendered' check inside AppLayout, you need to force a render when coming to the main screen from the login screen for the first time
  // this separate method is the ONLY way I managed to get it to work
  // I tried to have a internal boolean appLayoutRendered but it didn't work
  forceInitialRender: function() {
    console.log('RouterController.forceInitialRender: AppLayout already rendered? '+this.appLayoutRendered);

    // needed for special case of user reloading on #someroute and the login screen is bypassed
    if (this.appLayoutRendered) {
      console.log('RouterController.forceInitialRender: SPECIAL BYPASS CASE, APPLAYOUT ALREADY RENDERED');
      return;
    }

    // remove login background class on body
    if (this.loginScreenShown) {
      this.loginScreen.navigateAway();
      this.loginScreenShown = false;
    }

    this.appLayoutRendered = true;
    this.appLayout.render();
  },


/* --- the router tells the app layout to show a specific child view in the 'main' region, and is resppnsible to ensure the initial render --- */

  // the first time we render any view in the main content (i.e anything under the nav bar, i.e. anything not the login screen)
  // we need to make sure the base layout (nav bar + main content container) has been rendered
  checkAppLayoutRendered: function() {
    if (!this.appLayoutRendered) {
      this.forceInitialRender();
    }
  },

  showLoadingScreen: function() {
    console.log('RouterController.showLoadingScreen: AppLayout already rendered? '+this.appLayoutRendered);
    this.checkAppLayoutRendered();
    this.appLayout.showLoadingScreen();
  },

  showErrorScreen: function(errorCode) {
    console.log('RouterController.showErrorScreen: AppLayout already rendered? '+this.appLayoutRendered);
    this.checkAppLayoutRendered();
    this.appLayout.showErrorScreen(errorCode);
  },

  showPageNotFound: function() {
    console.log('RouterController.showPageNotFound: AppLayout already rendered? '+this.appLayoutRendered);
    this.checkAppLayoutRendered();
    this.appLayout.showErrorScreen(404);
  },

  showHomeScreen: function() {
    console.log('RouterController.showHomeScreen: AppLayout already rendered? '+this.appLayoutRendered);
    this.checkAppLayoutRendered();
    this.appLayout.showHomeScreen();
  },

  showParameterScreen: function(projectId) {
    console.log('RouterController.showParameterScreen: AppLayout already rendered? '+this.appLayoutRendered);
    this.checkAppLayoutRendered();
    this.appLayout.showParameterScreen(projectId);
  },

  showTacticalScreen: function(projectId) {
    console.log('RouterController.showTacticalScreen: AppLayout already rendered? '+this.appLayoutRendered);
    this.checkAppLayoutRendered();
    this.appLayout.showTacticalScreen(projectId);
  },

  showSolutionScreen: function(projectId, operationalNeedId) {
    console.log('RouterController.showSolutionScreen: AppLayout already rendered? '+this.appLayoutRendered);
    this.checkAppLayoutRendered();
    this.appLayout.showSolutionScreen(projectId, operationalNeedId);
  },

  showCanvasScreen: function(projectId, operationalNeedId) {
    console.log('RouterController.showCanvasScreen: AppLayout already rendered? '+this.appLayoutRendered);
    this.checkAppLayoutRendered();
    this.appLayout.showCanvasScreen(projectId, operationalNeedId);
  },

  showTacticScreen: function(projectId, operationalNeedId) {
    console.log('RouterController.showTacticScreen: AppLayout already rendered? '+this.appLayoutRendered);
    this.checkAppLayoutRendered();
    this.appLayout.showTacticScreen(projectId, operationalNeedId);
  },

  showParameterExport: function(projectId) {
    console.log('RouterController.showParameterExportScreen: AppLayout already rendered? '+this.appLayoutRendered);
    this.checkAppLayoutRendered();
    this.appLayout.showParameterExport(projectId);
  },

  showOperationalNeedExport: function(projectId) {
    console.log('RouterController.showOperationalExportScreen: AppLayout already rendered? '+this.appLayoutRendered);
    this.checkAppLayoutRendered();
    this.appLayout.showOperationalNeedExport(projectId);
  },

  showFinalTacticExport: function(projectId, operationalNeedId) {
    console.log('RouterController.showFinalExportScreen: AppLayout already rendered? '+this.appLayoutRendered);
    this.checkAppLayoutRendered();
    this.appLayout.showFinalTacticExport(projectId, operationalNeedId);
  }

});
;/**********************************************************************************/
/*  Top level Controller responsible from getting data form server, and formatting it in a more useful way when necessary
 /**********************************************************************************/

BestForMe.DataManager = Backbone.Marionette.Object.extend({

  // store in a app object all the data that needs to be shared with several modules (to reduce init boilerplate code)
  // empty object created by root app with this structure
  // the data manager is responsible for population the 'data' sub-object from the endpoints
  appData : null,

  // Backbone data radio channel
  // Data Manager uses it to broadcast a message that all data have been retrieved, or there was an error
  dataChannel: null,

  // the collections are fetched asynchronously
  // these booleans keep track of which have been fetched successfully
  // when all core data has been fetched, then we can tell the main app to show the main screen

  // check that all core data amongst the above have been fetched
  coreDataFetched: false,

  // MM: when an error happens on data fetch, it is likely to happen several times (on each collection or model)
  // only redirect to the the login screen once
  errorHandlingInProgress: false,

  // as soon as both userStats and cases are fetched, add some data to userStats
  // this boolean tracks that we only do it once

  // Handles additional BestForMe modules, not bundled with core
  pathwaysDataManager: null,
  // module specific core data
  pathwaysCoreDataFetched: false,

  /* --- Initialisation code  --- */

  initialize: function(config) {
    this.appData = config.appData;

    // listen for message from views requesting data
    // listen for message from module data managers telling they have fetched their data
    this.dataChannel = Backbone.Radio.channel('data');
    this.listenTo(this.dataChannel, 'pathways:core:data:fetched', this.onPathwaysCoreDataFetched);

    // create data structures (collections and models) with endpoint urls
    this.initData();
  },

  initData: function() {

    // create data collections with endpoint urls

    // create the module data managers
    if (this.appData.modules.pathways) {
      this.pathwaysDataManager = new BestForMe.PathwaysDataManager({
        appData: this.appData
      });
    }
  
  },

  /* --- If a user logs out, clear all the data  --- */

  // clear all data so nothing is accidentally available to other users without authorised login
  // called by main app after user logs out
  // do not catch the logout event directly because main app needs to control order of data clearing happening in auth and data manager
  clearData: function() {

    console.log('DataManager.clearData');

    // reset the flags that track which data has been fetched

    // MM: Do not forget the general flag otherwise it does not recheck for data loaded after logout,
    // and stays stuck on loading screen even though everything is loaded!
    this.coreDataFetched = false;

    if (this.appData.modules.pathways) {
      this.pathwaysDataManager.clearData();
      this.pathwaysCoreDataFetched  = false;
    }

  },


  /* --- Once authentification complete, the app tells the data manager to fetch all the data  --- */

  fetchData: function() {

    console.log('DataManager.fetchData : GETTING DATA FROM SERVER NOW!');

    // needed in case this fetch ia a retry after server error
    this.errorHandlingInProgress = false;

    // capture 'this' for callbacks
    var me = this;

    // tell the module data managers to fetch the module specific core data
    if (this.appData.modules.pathways) {
      this.pathwaysDataManager.fetchModuleCoreData();
    }

  },

  dataFetchSuccess: function(model, response, options, dataName) {

    console.log('DataManager.dataFetchSuccess: '+dataName);

    // check whether all core data have been fetched (unless it's already set and we're fetching additional data)
    if (!this.coreDataFetched) {
      this.checkCoreDataFetched();
    }

  },

  dataFetchError: function(model, response, options, dataName) {

    console.log('DataManager.dataFetchError: '+dataName+', error handling in progress: '+this.errorHandlingInProgress);

    // MM: dock and statistics should fail silently
    var failSilently = (dataName === 'statistics' || dataName === 'dock' || dataName === 'footer');

    // data that fail silently should not count for errorhandling in errorHandlingInProgress, as they could prevent other errors from being acted upon
    if (failSilently) {

      // defaultAction = false -> tell the error handler mot to process the action itself, since we want to ignore it
      var formattedError = this.handleError(response, options, false);

      // tell the home screen to hide empty sections and the app to set the feature to false
      this.dataChannel.trigger('missing:data', dataName);

    }
    // MM: when an error happens on collection fetch, it is likely to happen several times (on each collection of the core data fetched simultaneously)
    // only redirect to the the login screen once
    else if (!this.errorHandlingInProgress) {

      this.errorHandlingInProgress = true;

      // handleError method is on ErrorHandlerMixin
      // defaultAction = true -> tell the error handler to process the action itself (most common case)
      var formattedError = this.handleError(response, options, true);

      // for core data only, it's not enough to just display the message if it's a server down error
      // we want to stop being stuck on the loading screen as soon as we know there is a server error
      if (formattedError.action === 'message' && (formattedError.errorCode === 500 || formattedError.errorCode === 503 || formattedError.errorCode === 504 || formattedError.errorCode === 0) ) {
        this.dataChannel.trigger('data:fetch:error', formattedError);
      }

    }
  },

  onPathwaysCoreDataFetched: function() {

    console.log('DataManager.onPathwaysCoreDataFetched');
    this.pathwaysCoreDataFetched = true;

    // check whether all core data have been fetched (unless it's already set and we're fetching additional data)
    if (!this.coreDataFetched) {
      this.checkCoreDataFetched();
    }
  },

  checkCoreDataFetched: function() {
    // core data is everythig needed on the welcome screen
    if (this.pathwaysCoreDataFetched === true ) {
      this.coreDataFetched = true;
      // tell the main app all data have been fetched, so it can route to the main screen
      this.dataChannel.trigger('data:fetched');
    }
  }

});

// Copy the errorHandler mixin methods to BestForMe.DataManager
_.extend(BestForMe.DataManager.prototype, BestForMe.ErrorHandlerMixin);
;/*******************************************************************/
/*   View: displays the header and swaps out the views in the main content area
 /*******************************************************************/


BestForMe.AppLayout = Backbone.Marionette.LayoutView.extend({

  el: '#bestForMe-app',

  template: BestForMe.Templates['app-layout'],

  ui: {
    uiHeader: '#header',
    uiMain: '#main',
  },

  regions: {
    header: '#header',
    main: '#main',
    tutorial: '#tutorial',
    footer: '#footer'
  },

  childEvents: {
    'reset:app:layout': 'resetAppLayout'
  },

  // data passed on by root app, shared between views
  appData: null,

  /* --- init data --- */

  initialize: function(options) {
    this.appData = options.appData;
  },

  /* --- intitial rendering of the app Layout (render header, footer and  default main view) --- */

  onRender: function() {
    console.log('AppLayout.onRender: '+this.isRendered);

    // MM: the Mn doc says to show the child views from onBeforeShow event but it does not get fired!!

    // render the header and footer only by default
    // it sjust prepares the main region, the child view is added to the main region separately
    var headerView = new BestForMe.HeaderView({
      appData: this.appData
    });
    this.showChildView('header', headerView);
    var footerView = new BestForMe.FooterView({
      appData: this.appData
    });
    this.showChildView('footer', footerView);
    var tutorialView = new BestForMe.TutorialView({
      appData: this.appData
    });
    this.showChildView('tutorial', tutorialView);
  },

  /* --- handles overlay elements such as banners and notifications --- */


  /* --- the router tells the app layout to show a specific child view in the 'main' region, and is responsible to ensure the initial render --- */

  showLoadingScreen: function() {
    console.log('AppLayout.showLoadingScreen: '+this.isRendered);

    var loadingScreen = new BestForMe.LoadingScreen();
    this.showChildView('main', loadingScreen);
  },

  showErrorScreen: function(errorCode) {
    console.log('AppLayout.showErrorScreen: '+errorCode+' '+this.isRendered);

    var errorScreen = new BestForMe.ErrorScreen({
      appData: this.appData,
      errorCode: errorCode
    });
    this.showChildView('main', errorScreen);
  },

  showHomeScreen: function() {
    console.log('AppLayout.showHomeScreen: '+this.isRendered);

    var projectScreen = new BestForMe.ProjectListView({
      appData: this.appData,
      // MM: copied from capsule quizzes where you can't set the collection from apData within init
      collection: this.appData.data.pathways.projects
    });
    this.showChildView('main', projectScreen);
  },

  showParameterScreen: function(projectId) {
    console.log('AppLayout.showParameterScreen for project: '+projectId+' '+this.isRendered);

    var parameterScreen = new BestForMe.ParameterView({
      appData: this.appData,
      projectId: projectId
    });
    this.showChildView('main', parameterScreen);
  },

  showTacticalScreen: function(projectId) {
    console.log('AppLayout.showTacticalScreen for project: '+projectId+' '+this.isRendered);

    var tacticalScreen = new BestForMe.TacticalView({
      appData: this.appData,
      projectId: projectId
    });
    this.showChildView('main', tacticalScreen);
  },

  showSolutionScreen: function(projectId, operationalNeedId) {
    console.log('AppLayout.showSolutionScreen for project: '+projectId+' '+this.isRendered);

    var solutionScreen = new BestForMe.SolutionView({
      appData: this.appData,
      projectId: projectId,
      operationalNeedId: operationalNeedId
    });
    this.showChildView('main', solutionScreen);
  },

  showCanvasScreen: function(projectId, operationalNeedId) {
    console.log('AppLayout.showCanvasScreen for project: '+projectId+' '+this.isRendered);

    var canvasScreen = new BestForMe.CanvasView({
      appData: this.appData,
      projectId: projectId,
      operationalNeedId: operationalNeedId
    });
    this.showChildView('main', canvasScreen);
  },

  showTacticScreen: function(projectId, operationalNeedId) {
    console.log('AppLayout.showTacticScreen for project: '+projectId+' '+this.isRendered);

    var tacticScreen = new BestForMe.TacticView({
      appData: this.appData,
      projectId: projectId,
      operationalNeedId: operationalNeedId
    });
    this.showChildView('main', tacticScreen);
  },

  showParameterExport: function(projectId) {
    console.log('AppLayout.showExportScreen for project: '+projectId+' '+this.isRendered);

    var parameterExport = new BestForMe.ParameterExport({
      appData: this.appData,
      projectId: projectId
    });
    this.showChildView('main', parameterExport);
  },

  showOperationalNeedExport: function(projectId) {
    console.log('AppLayout.showExportScreen for project: '+projectId+' '+this.isRendered);

    var operationalNeedExport = new BestForMe.OperationalNeedExport({
      appData: this.appData,
      projectId: projectId
    });
    this.showChildView('main', operationalNeedExport);
  },

  showFinalTacticExport: function(projectId, operationalNeedId) {
    console.log('AppLayout.showExportScreen for project: '+projectId+' '+this.isRendered);

    var finalTacticExport = new BestForMe.FinalTacticExport({
      appData: this.appData,
      projectId: projectId,
      operationalNeedId: operationalNeedId
    });
    this.showChildView('main', finalTacticExport);
  },

  resetAppLayout: function() {
    this.ui.uiHeader.css('margin-top', '0');
    this.ui.uiMain.css('padding-top', '211px');
  }

});
;/*******************************************************************/
/*   View: Login screen
/*******************************************************************/

BestForMe.LoginScreen = Backbone.Marionette.ItemView.extend({

  el: '#bestForMe-app',

  template: BestForMe.Templates['login-screen'],

  ui: {
    username: '.login-username',
    password: '.login-password',
    rememberMe: '.login-save-checkbox',
    loginLabel: '.login-save-prompt',
    submit: '.login-submit',
    resetPassword: '.login-reset-password'
  },

  events: {
    'click @ui.submit': 'submitLogin',
    'click @ui.resetPassword': 'resetPassword',
    'click @ui.loginLabel': 'toggleRememberMe',
    'keypress @ui.username': 'processKey',
    'keypress @ui.password': 'processKey'
  },

  // Backbone auth radio channel 
  // required for messaging between modules/views who don't have a direct reference to auth, so can't directly listen to events on it
  authChannel: null,

  // cache Body element to add a class to the body because it needs a different background colour for the login screen
  bodyEl: null,

  // title of page
  title: null,

  initialize: function(options) {
    this.title = options.title;
    // listen on the auth channel for error message that needs to be passed on to login view
    this.authChannel = Backbone.Radio.channel('auth');
    this.listenTo(this.authChannel, 'login:invalid', this.onLoginInvalid);
    // the auth sends the alert box itelf now, we only need to render to clear the text inputs on success or error
    this.listenTo(this.authChannel, 'request:password:reset:success', this.render);
    this.listenTo(this.authChannel, 'request:password:reset:error', this.render);
    this.bodyEl = document.getElementsByTagName("BODY")[0];
  },

  onRender: function() {
    console.log('LoginScreen.onRender');
    // add a class to the body because it needs a different background colour for the login screen
    this.bodyEl.classList.add('login-bg');
  },

  navigateAway: function() {
    console.log('LoginScreen.navigateAway');

    // remove body class when navigating away, but login screen not destroyed in case app needs to show it again on data error
    this.bodyEl.classList.remove('login-bg');
  },

/* UI on login screen */

  processKey: function(e) {
    if(e.which === 13) // enter key
      this.submitLogin();
  },

  submitLogin: function() {

    var username = this.ui.username.val();
    var password = this.ui.password.val();
    var rememberMe = this.ui.rememberMe[0].checked;

    if (username === "") {
      alert('Please enter a valid username.');
    }   
    else if (password === "") {
      alert('Please enter a valid password.');
    }     
    else {
      console.log('LoginScreen.submitLogin LOGIN SAVED username: '+username+', password: '+password+', Stay Logged in?: '+rememberMe);

      // save the login model locally in any case, whether the user wants to stay logged in or not
      this.model.set({
        username: username,
        password: password
      });
      
      // authentification used to listen to change event on login model to pick up when login screen has modified it
      // this seemed not to work when a login happens after a server error, even though it worked fine on initial login
      // Fix: make the login view explicitely send a user:login event
      // rememberMe: tells the auth whether to save token (onkly, not login itself) in local storage or not
      this.authChannel.trigger('user:login', rememberMe);
    }
    
  },

  resetPassword: function() {
    var username = this.ui.username.val();
    var me = this;
    swal({
      title: "Forgotten Password?",
      text: "Please enter your username to reset your password.",
      type: "input",
      showCancelButton: true,
      closeOnConfirm: false,
      inputPlaceholder: "Username",
      inputValue: this.ui.username.val(),
      closeOnConfirm: true
    }, function (inputValue) {
      if (inputValue === false) return false;
      if (inputValue === "") {
        swal.showInputError("Please enter your username");
        return false
      }
      username = inputValue;
      console.log(inputValue);
      me.authChannel.trigger('request:password:reset', username);
    });
  },

  toggleRememberMe: function() {
    if (this.ui.rememberMe[0].checked){
      this.ui.rememberMe[0].checked = false;
    }
    else {
      this.ui.rememberMe[0].checked = true;
    }
  },

/* Login screen reacts to events fired by other parts of the app */

  // fired when a login error occured
  // rerender the screen showing error message
  onLoginInvalid: function(errorMessage) {

    console.log('LoginScreen.onLoginInvalid : '+errorMessage);

    // clear the login model since it is invalid anyway
    this.model.clear();

    //display error message on login screen
    swal(errorMessage);
    // rendering not necessary to show the alert, but it clears the invalid login from the input boxes
    this.render();
  }, 

  onRender: function() {
    if (this.title) {
      this.changePageTitle(this.title, "Login");
    }
  }

});

_.extend(BestForMe.LoginScreen.prototype, BestForMe.ChangeTitleMixin);
;/*******************************************************************/
/*   View: Loading Screen
/*******************************************************************/

BestForMe.LoadingScreen = Backbone.Marionette.ItemView.extend({

  template: BestForMe.Templates['loading-screen'],

  // Backbone router radio channel
  // this is used by views to trigger navigation to a different route
  routerChannel: null,

  // variable to hold loading setTimeout, so we don't get stuck on the loading screen forever is the server does not reply
  serverTimeout: null,
  // server Timeout delay, set to 15 seconds
  serverTimeoutDelay: 15000,

  initialize: function(options) {

    // radio channel used by views to trigger navigation to a different route
    this.routerChannel = Backbone.Radio.channel('router');
  },

  onRender: function() {

    // set a timeout where we just assume a server error after 30 seconds if the server does not return a response itself
    var me = this;
    this.serverTimeout = setTimeout(function(){ me.onServerTimeout(me); }, me.serverTimeoutDelay);
  },

  onDestroy: function() {

    // clear serverTimeout if we're navigating away to a content screen after data has loaded
    clearTimeout(this.serverTimeout);
  },

  // set a timeout where we just assume a server error after 3 seconds if the server does not return a response itself
  onServerTimeout: function(me) {

    console.log('LoadingScreen.onServerTimeout');

    // clear serverTimeout
    clearTimeout(me.serverTimeout);

    // tell the app the loading screen has timed out
    this.routerChannel.trigger('server:down');
  }
  
});
;/*******************************************************************/
/*   View: Error Screen
/*
/* MM: due to limitation of the backbone router, it is not possible to pass complex parameters such as the error message
/* However it is possible to pass a short route param such as the error code
/* so we put on main appData a lookup table of error messages by error codes, shared between the error screen and the error handler
/* !!! only used by the standalone error screen, does not affect custom on-screen error notices on normal content screens looked up based on error code
/* not ideal but still better that overriding the backbone router navigate core code to make it able to handle custom params, which may stop working if we update backbone
/*******************************************************************/

BestForMe.ErrorScreen = Backbone.Marionette.ItemView.extend({

  template: BestForMe.Templates['error-screen'],

  // appData contains errorMessage lookup
  appData: null,

  // errorCode passed on by app, 0 by default
  errorCode: 0,

  // display message explaining error 
  errorMessage: '',

  initialize: function(options) {

    this.appData = options.appData;

    if (options.errorCode) {
      this.errorCode = options.errorCode;
    }
    // get error message from lookup based on error code
    this.errorMessage = this.appData.errorMessage[this.errorCode];
  },

  templateHelpers: function () {
    return {
      message: this.errorMessage
    };
  }

});
;BestForMe.HeaderView = Backbone.Marionette.LayoutView.extend({

  template: BestForMe.Templates['header'],

  home: '/home',

  ui: {
    headerNav: '#header-nav',
    agilityNav: '#agility-nav'
  },

  behaviors: {
    // prevent backbone from wrapping the template inside an extra div]
    removeTemplateWrapperBehavior: {
      behaviorClass: BestForMe.RemoveTemplateWrapperBehavior
    },
    // programmatically triggers router.navigate on internal link click, needed when History pushstate is enabled, also works when disabled
    internalLinkBehavior: {
      behaviorClass: BestForMe.InternalLinkBehavior
    }
  },

  // handles showing and hiding ui elements
  uiChannel: null,

  // keep track of active page
  activePage: null,

  // appData for data
  appData: null,

  // project Id dynamically updated and added to links
  projectId: null,
  // project title displayed in header when we are in a project subview
  projectTitle: null,
  // same for nested operational, except in parameter guide and tactical specification screens, where we are still at top project level
  operationalNeedId: null,
  operationalNeedTitle: null,

  // config which parts of the nav should be visible on each page
  showNav: false,
  showAgilityNav: false,

  // MM: specify which links need the additional operational need url parameter
  navCollection: new Backbone.Collection([
    {
      title: 'Parameter Guide',
      link: '/parameter-guide',
      active: true,
      hasOperationalNeedParam: false
    },{
      title: 'Tactical Specification',
      link: '/tactical-specification',
      active: false,
      hasOperationalNeedParam: false
    },{
      title: 'Agility Matrix',
      link: '/agility-matrix',
      active: false,
      hasOperationalNeedParam: true
    }
  ]),

  agilityCollection: new Backbone.Collection([
    {
      title: 'Technical Solution Library',
      link: '/technical-solution-library',
      active: true,
      hasOperationalNeedParam: true
    },{
      title: 'Tactical Canvas',
      link: '/tactical-canvas',
      active: false,
      hasOperationalNeedParam: true
    },{
      title: 'Final Tactic',
      link: '/final-tactic',
      active: false,
      hasOperationalNeedParam: true
    }
  ]),

  initialize: function(options) {
    this.appData = options.appData;
    this.uiChannel = Backbone.Radio.channel('ui');
    this.listenTo(this.uiChannel, 'update:nav', this.updateNav);
  },

  templateHelpers: function() {
    var origin =  window.location.origin;
    return {
      home: this.home,
      origin: origin,
      agility: this.agilityCollection,
      nav: this.navCollection,
      projectId: this.projectId,
      projectTitle: this.projectTitle,
      operationalNeedId: this.operationalNeedId,
      operationalNeedTitle: this.operationalNeedTitle,
      showNav: this.showNav,
      showAgilityNav: this.showAgilityNav
    };
  },

  // Configure the nav for each page with one single event
  // previously, rerendering the project Id in the links could remove the show/hide css applied separately
  // show/hide overall nav and agility subnav
  // put the project id in the links, and display project title in header
  // navConfig = {
  //  projectId: int/ null on project list
  //  operationalNeedId: int/ null on project list, paramter list, tactical specification
  //  showNav: true/false
  //  showAgilityNav: true/false
  // }
  updateNav: function(navConfig) {
    var link = document.location.href.split('/');
    link = ("/" + link[3]);

    if (navConfig.showAgilityNav) {
      this.navCollection.each(function(model){
        model.set('active', false);
      });
      var linkModel = this.navCollection.where({link: '/agility-matrix'})[0];
      linkModel.set('active', true);
      this.agilityCollection.each(function(model){
        model.set('active', false);
      });
      var agilityModel = '';
      if (link === '/agility-matrix') {
        agilityModel = this.agilityCollection.where({link: '/technical-solution-library'})[0];
      }
      else {
        agilityModel = this.agilityCollection.where({link: link})[0];
      }
      agilityModel.set('active', true);
    }
    else if (navConfig.showNav) {
      this.navCollection.each(function (model) {
        model.set('active', false);
      });
      var navModel = this.navCollection.where({link: link})[0];
      navModel.set('active', true);
    }

    // MM: the only screen where projectId won't be defined is the projects screen, where the navbar is not shown, so it won't cause a problem of missing link parameter
    this.projectId = navConfig.projectId;
    if (this.projectId) {
      this.projectTitle = this.appData.data.pathways.projects.at(this.projectId - 1).get('name');
    }
    else {
      this.projectTitle = null;
    }

    // MM: however, on the paramater guide and tactical specification screens, operationalNeedId won't be chosen yet
    // but the link that need it as a param are displayed
    // as simple workaround to get functional links, set operationalNeedId to 1
    //proper solution woyld be to either hide the links or redirect to list of operational needs to get user to navigate through 1
    // but both as more complicated, so only do if client asks, and pays for it since their prototytpe did not support multiple ON at all
    this.operationalNeedId = navConfig.operationalNeedId;
    if (this.operationalNeedId) {
      this.operationalNeedTitle = this.appData.data.pathways.projects.at(this.projectId - 1).get('operationalNeeds').at(this.operationalNeedId - 1).get('name');
    }
    else {
      this.operationalNeedId = 1;
      // do not display ON title on the sscrees where ON is NOT defined, even though we fake the links
      this.operationalNeedTitle = null;
    }

    this.showNav = navConfig.showNav;
    this.showAgilityNav = navConfig.showAgilityNav;
    this.render();
  }

});
;/**
 * Layout view to render footer links
 */
BestForMe.FooterView = Backbone.Marionette.LayoutView.extend({

  template: BestForMe.Templates['footer/footer'],

  behaviors: {
    // prevent backbone from wrapping the template inside an extra div]
    removeTemplateWrapperBehavior: {
      behaviorClass: BestForMe.RemoveTemplateWrapperBehavior
    }
  },

  ui: {
    footerContainer: '.footer',
    tutorialButton: '#show-tutorial',
    saveButton: '.save-button',
    exportButton: '.export-button'
  },

  events: {
    'click @ui.tutorialButton': 'showTutorial',
    'click @ui.saveButton': 'saveNext'
  },

  appData: null,

  // handles showing and hiding ui elements
  uiChannel: null,
  dataChannel: null,

  // project Id dynamically updated on each page
  projectId: null,
  // same for nested operational, except in parameter guide and tactical specification screens, where we are still at top project level
  operationalNeedId: null,

  // link that should be triggered when user clicks on export button (depends on current route)
  exportLink: null,

  // whether to show the save and export buttons (depends on current route)
  showSave: false,
  showExport: false,

  initialize: function(options) {
    this.appData = options.appData;
    this.dataChannel = Backbone.Radio.channel('data');
    this.uiChannel = Backbone.Radio.channel('ui');
    this.listenTo(this.uiChannel, 'update:footer', this.updateFooter);
  },

  templateHelpers: function() {
    var origin =  window.location.origin;
    return {
      origin: origin,
      projectId: this.projectId,
      operationalNeedId: this.operationalNeedId,
      exportLink: this.exportLink,
      showSave: this.showSave,
      showExport: this.showExport
    }
  },
  
  // Configure the footer for each page with one single event
  // footerConfig = {
  //  projectId: int/ null on project list
  //  operationalNeedId: int/ null on project list, paramter list, tactical specification
  //  showSave: true/false
  //  showExport: true/false
  // }
  updateFooter: function(footerConfig) {

    this.projectId = footerConfig.projectId;
    // operationalNeedId for final tactic export only
    this.operationalNeedId = footerConfig.operationalNeedId;
    // whether to show the save and export buttons (depends on current route)
    this.showSave = footerConfig.showSave;
    this.showExport = footerConfig.showExport;

    var location = Backbone.history.fragment;
    console.log('UPDATE FOOTER: '+location);
    if (location.match(/parameter-guide/)) {
      this.exportLink = '/export-parameters/';
    }
    else if (location.match(/tactical-specification/)) {
      this.exportLink = '/export-operational-need/';
    }
    else if (location.match(/final-tactic/)) {
      this.exportLink = '/export-final-tactic/';
    }
    this.render();
  },

  // show tutorial side panel
  showTutorial: function() {
    this.dataChannel.trigger('show:tutorial');
  },

  // handle 'save and next' button clicked
  saveNext: function() {
    var location = Backbone.history.fragment;
    console.log('saveNext FOR LOCATION: ' + location);
    if (location.match(/parameter-guide/)) {
      this.dataChannel.trigger('save:next:parameter');
    }
    else if (location.match(/tactical-specification/)) {
      this.dataChannel.trigger('save:next:tactical')
    }
    else if (location.match(/agility-matrix/) || location.match(/technical-solution-library/)) {
      this.dataChannel.trigger('save:next:technical:solution:library');
    }
    else if (location.match(/tactical-canvas/)) {
      this.dataChannel.trigger('save:next:tactical:canvas')
    }
    else {
      console.log('saveNext not enabled on current route!!!');
    }
  }

});
;/*******************************************************************/
/*   Init code creating a instance of application
/*   This is the only code code that should go in document.ready
/*******************************************************************/


$(function () {
  'use strict';

  // Marionette app init config
  var bestForMeConfig = {
    pathwaysEndpoint: {
      parameter: '/parameter.json',
      tacticalFamilies: '/tactical-families.json',
      technicalFamilies: '/technical-families.json'
    },
    debug: 'true',
    title: 'Pathways',
    // tells which shared/homepage bestForMe features are enabled in this build
    features: {
      // special mode to bypass the login and get data locally, no server calls at all, after initial load, the webapp runs by itself
      localMode: 'true'
    },
    // tells which bestForMe modules are enabled in this build
    modules: {
      // engage will enable: articles + news + notifications, it's not possible to get just one of these without the others
      engage: 'false',
      pathways: 'true'
    }
  };

  var bestForMe = new BestForMe(bestForMeConfig);

  // MM TEMP TEST: comment out to clear the test projects
  //localStorage.clear();

  bestForMe.start();

});
