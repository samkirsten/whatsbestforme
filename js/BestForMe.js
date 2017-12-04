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
      ee: null,
      three: null,
      vodafone: null,
      o2: null,
      ofcom: null,
      results: null
    },

    // tells which bestForMe modules are enabled in this build
    modules: {
      bestForMe: false
    },

      features: {
      footer: false
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

    // radio channel  to tell when data has been loaded from server
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
      appData: this.appData
    });

    this.router = new BestForMe.Router({
      appData: this.appData,
      controller: this.routerController
    });
  },

  // init AppData object
  initAppData: function(config) {

      this.appData.localMode = true;
      // in local mode, data is local json files
      this.appData.apiBaseUrl = '/data';


    // set data endpoints from config on main app object
    // MM  TODO on main bestForMe: we should match the structure endpoint.dataname in config too, and only init the endpoint if the module is enabled in the build
    this.appData.endpoints.ee = config.eeEndpoint;
    this.appData.endpoints.three = config.threeEndpoint;
    this.appData.endpoints.vodafone = config.vodafoneEndpoint;
    this.appData.endpoints.o2 = config.o2Endpoint;
    this.appData.endpoints.ofcom = config.ofcomEndpoint;
    this.appData.title = config.title;
    this.appData.debug = config.debug;

      this.appData.features.footer = false;

      this.appData.modules.bestForMe = true;
  },

  /* --- Start code: start app once all submodules have been created  --- */

  onStart: function() {

    console.log('BestForMe.START href: '+window.location.href+' pathname: '+window.location.pathname+' hash: '+window.location.hash);

    console.log('LOCALMODE: '+this.appData.localMode);

    // try to detect if the user is trying to load a specific page
    // the server will serve bestForMe root but we try to redirect to the desired page after the data has loaded
    // MM: I think we should detect on start, not init, but not 100% sure

    // !!! start router history BEFORE starting the authentification event chain, otherwise it's too late for the login screen to show up!!!
    // MM: {pushState: true} enables url without # but the server needs to be able to cope with them and serve the app
    // if the server served the base bestForMe then I think we'd be able to pick up the location and toute to it on client side
    Backbone.history.start({pushState: true});
    //Backbone.history.start();

      this.bypassAuth();
  },
  /* --- Code waiting for messages from authentification module  --- */

  // bypass auth in local mode
  bypassAuth: function() {

    console.log('App.bypassAuth');

    // show a temp screen with the BestForMe header but a spinning wheel in the main content view
    // this view show in the grey area time when the login is complete but the core data has not been fetched yet
    // despite the 'isRendered' check inside AppLayout, you need to force a render when coming to the main screen from the login screen for the first time
    // this separate method is the ONLY way I managed to get it to work
    // with local data it should harldly have time to show at all
    // but we're doing things properly in case the json file is not found or can't be read
    this.routerController.forceInitialRender();
    this.router.navigate('home', {trigger: true});
  },


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

});;this["BestForMe"] = this["BestForMe"] || {};
this["BestForMe"]["Templates"] = this["BestForMe"]["Templates"] || {};

this["BestForMe"]["Templates"]["app-layout"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<header id=\"header\"></header>\n<main id=\"main\"></main>\n<results id=\"results\"></results>\n<tutorial id=\"tutorial\"></tutorial>\n<footer id=\"footer\"></footer>";
},"useData":true});

this["BestForMe"]["Templates"]["error-screen"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var helper;

  return "<section id=\"error\">\n  <div class=\"error-notice\">\n    <p class=\"error-message\">"
    + container.escapeExpression(((helper = (helper = helpers.message || (depth0 != null ? depth0.message : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"message","hash":{},"data":data}) : helper)))
    + "</p>\n  </div>\n</section>\n";
},"useData":true});

this["BestForMe"]["Templates"]["footer/footer"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<footer class=\"footer\">\n  <div class=\"footer-container\">\n    <div class=\"footer-content\">\n\n    </div>\n  </div>\n</footer>\n";
},"useData":true});

this["BestForMe"]["Templates"]["header"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    var helper;

  return ": "
    + container.escapeExpression(((helper = (helper = helpers.projectTitle || (depth0 != null ? depth0.projectTitle : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"projectTitle","hash":{},"data":data}) : helper)));
},"3":function(container,depth0,helpers,partials,data) {
    var helper;

  return " - "
    + container.escapeExpression(((helper = (helper = helpers.operationalNeedTitle || (depth0 != null ? depth0.operationalNeedTitle : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"operationalNeedTitle","hash":{},"data":data}) : helper)));
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, helper, alias1=depth0 != null ? depth0 : {};

  return "<div id=\"header-inner\" class=\"header-inner\">\n\n  <div class=\"brand\">\n    <a href=\""
    + container.escapeExpression(((helper = (helper = helpers.home || (depth0 != null ? depth0.home : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(alias1,{"name":"home","hash":{},"data":data}) : helper)))
    + "\"><h1 class=\"brand-title\">What's Best For Me?"
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.projectTitle : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.operationalNeedTitle : depth0),{"name":"if","hash":{},"fn":container.program(3, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "</h1></a>\n  </div>\n\n    <div class=\"header-menu\">\n        <ul class=\"menu-list\">\n            <li class=\"menu-item\"><a href=\"/home\">Home</a></li>\n            <li class=\"menu-item\"><a href=\"/about\">About</a></li>\n        </ul>\n    </div>\n\n</div>\n\n";
},"useData":true});

this["BestForMe"]["Templates"]["home-screen"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<section id=\"home\">\n\n  <ul id=\"project-grid\" class=\"project-grid\">\n    <li class=\"project-hex\">\n      <div class=\"hex-in\">\n        <div class=\"hex-link\">\n          <span class='hex-bg'></span>\n          <h1>New Project</h1>\n          <button id=\"new-project-button\" class=\"project-open new-button\">+</button>\n        </div>\n      </div>\n    </li>\n    <li id=\"create-project\" class=\"project-hex\">\n      <div class=\"hex-in\">\n        <a class=\"hex-link\" href=\"#\">\n          <span class='hex-bg'></span>\n          <input class=\"project-name-input\"> </input>\n          <button id=\"create-project-button\" class=\"project-open new-button\">Create</button>\n        </a>\n      </div>\n    </li>\n    <div id=\"project-list\">\n\n    </div>\n  </ul>\n\n</section>\n";
},"useData":true});

this["BestForMe"]["Templates"]["loading-screen"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<section id=\"loading\">\n  <div class=\"loader\"></div>\n</section>\n";
},"useData":true});

this["BestForMe"]["Templates"]["login-screen"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<div class=\"full\">\n  <div class=\"login-divide\"><div id=\"login-brand\"></div></div>\n<main id=\"login-screen\">\n\n  <form class=\"login-form\">\n    <label for=\"username\">\n    </label>\n    <input name=\"username\" placeholder=\"Username\" class=\"login-username\" type=\"text\">\n    </input>\n    <label for=\"password\">\n    </label>\n    <input name=\"password\" placeholder=\"Password\" class=\"login-password\" type=\"password\">\n    </input>\n    <div class=\"login-forgotten-password\">\n      <input type=\"checkbox\" class=\"login-save-checkbox\" name=\"login-save\" value=\"login-save\"></input>\n      <p class=\"login-save-prompt\">Stay Logged In?</p>\n      <span class=\"login-reset-password\">Forgotten Password?</span>\n    </div>\n    <div class=\"login-button\">\n      <button tname=\"submit\" class=\"login-submit\" type=\"button\">Log in</button>\n    </div>\n  </form>\n</main>\n  <footer class=\"login-footer\">\n    <div class=\"login-footer-items\">\n    <span class=\"login-footer-icon\"></span>\n    <p class=\"login-footer-text\">Powered by BestForMe</p>\n    </div>\n  </footer>\n</div>\n";
},"useData":true});

this["BestForMe"]["Templates"]["postcode/postcode-item"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var helper;

  return "<li class=\"tag-item postcode-item\"><p>"
    + container.escapeExpression(((helper = (helper = helpers.postcode || (depth0 != null ? depth0.postcode : depth0)) != null ? helper : helpers.helperMissing),(typeof helper === "function" ? helper.call(depth0 != null ? depth0 : {},{"name":"postcode","hash":{},"data":data}) : helper)))
    + "</p><button class=\"clear-btn\">&#10006;</button></li>\n";
},"useData":true});

this["BestForMe"]["Templates"]["postcode/postcode-list"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<ul class=\"postcode-tag-list\">\n\n</ul>";
},"useData":true});

this["BestForMe"]["Templates"]["postcode/postcode-view"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<div class=\"postcode-input-container\">\n    <h3 class=\"postcode-input-label\">Enter a Postcode</h3>\n    <input class=\"postcode-input\" type=\"text\"> </input>\n    <div class=\"postcode-buttons\">\n    <button type=\"button\" class=\"add-button btn btn-dark\">Add Postcode</button>\n    <button type=\"button\" class=\"postcode-button btn btn-dark\">Search</button>\n    </div>\n</div>\n\n<div class=\"postcode-list-container\">\n\n</div>\n\n<div class=\"results-view\">\n\n</div>\n";
},"useData":true});

this["BestForMe"]["Templates"]["results/overall-result"] = Handlebars.template({"1":function(container,depth0,helpers,partials,data) {
    return "selected";
},"3":function(container,depth0,helpers,partials,data) {
    return "  <p class=\"logo-caption\">EE</p>";
},"5":function(container,depth0,helpers,partials,data) {
    return " <p class=\"logo-caption\">Three</p>";
},"7":function(container,depth0,helpers,partials,data) {
    return "      <p class=\"logo-caption\">Vodafone</p>";
},"9":function(container,depth0,helpers,partials,data) {
    return "<p class=\"logo-caption\">O2</p>";
},"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var stack1, alias1=depth0 != null ? depth0 : {};

  return "<div class=\"jumbotron jumbotron-fluid\">\n    <div class=\"container\">\n        <h1 class=\"jumbo-title\">Best Provider</h1>\n        <p class=\"lead\"></p>\n        <div class=\"container logo-grid\">\n            <div class=\"col-xs-3\">\n                <div class=\"img-container\">\n                    <img class=\"provider-logo ee-logo "
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.ee : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\" src=\"../../assets/images/EE.png\">\n                </div>\n                "
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.ee : depth0),{"name":"if","hash":{},"fn":container.program(3, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\n            </div>\n            <div class=\"col-xs-3\">\n                <div class=\"img-container\">\n                    <img class=\"provider-logo three-logo "
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.three : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\" src=\"../../assets/images/Three.png\">\n                </div>\n                "
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.three : depth0),{"name":"if","hash":{},"fn":container.program(5, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\n            </div>\n            <div class=\"col-xs-3\">\n                <div class=\"img-container\">\n                    <img class=\"provider-logo vodafone-logo "
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.vodafone : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\" src=\"../../assets/images/Vodafone.png\">\n                </div>\n                "
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.vodafone : depth0),{"name":"if","hash":{},"fn":container.program(7, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\n            </div>\n            <div class=\"col-xs-3\">\n                <div class=\"img-container\">\n                    <img class=\"provider-logo o2-logo "
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.o2 : depth0),{"name":"if","hash":{},"fn":container.program(1, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\" src=\"../../assets/images/O2.png\">\n                </div>\n                "
    + ((stack1 = helpers["if"].call(alias1,(depth0 != null ? depth0.o2 : depth0),{"name":"if","hash":{},"fn":container.program(9, data, 0),"inverse":container.noop,"data":data})) != null ? stack1 : "")
    + "\n            </div>\n        </div>\n    </div>\n</div>\n\n";
},"useData":true});

this["BestForMe"]["Templates"]["results/results-postcode-item"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    var helper, alias1=depth0 != null ? depth0 : {}, alias2=helpers.helperMissing, alias3="function", alias4=container.escapeExpression;

  return "<li class=\"postcode-list-item list-group-item\">\n    <h1 class=\"result-postcode\">"
    + alias4(((helper = (helper = helpers.postcode || (depth0 != null ? depth0.postcode : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"postcode","hash":{},"data":data}) : helper)))
    + "</h1>\n    <!--<h3 class=\"result-provider\">"
    + alias4(((helper = (helper = helpers.bestProvider || (depth0 != null ? depth0.bestProvider : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"bestProvider","hash":{},"data":data}) : helper)))
    + "</h3>-->\n    <div class=\"provider-row\">\n        <div class=\"individual-result ee-result\">\n            <details>\n                <summary>\n                    <div class=\"small-logo-container\">\n                        <img class=\"small-provider-logo ee-logo selected\" src=\"../../assets/images/EE.png\">\n                    </div>\n                    <!-- <h3>EE</h3>-->\n                    <div class=\"provider-progress voice-progress progress\">\n                        <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.eeTotal || (depth0 != null ? depth0.eeTotal : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"eeTotal","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.eeTotal || (depth0 != null ? depth0.eeTotal : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"eeTotal","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                    </div>\n                    <div class=\"down-arrow-container\">\n                        <span class=\"down-arrow\"></span>\n                    </div>\n                </summary>\n                <ul class=\"list-group\">\n                    <li class=\"list-group-item voice-strength strength\">\n                        <img src=\"../../assets/images/megaphone.svg\" class=\"list-icon\">\n                        <label class=\"progress-label\">Voice</label>\n                        <div class=\"voice-progress progress\">\n                            <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.eeVoice || (depth0 != null ? depth0.eeVoice : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"eeVoice","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.eeVoice || (depth0 != null ? depth0.eeVoice : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"eeVoice","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                        </div>\n                    </li>\n                    <li class=\"list-group-item umts-strength strength\">\n                        <img src=\"../../assets/images/radio-tower.svg\" class=\"list-icon\">\n                        <label class=\"progress-label\">3G</label>\n                        <div class=\"umts-progress progress\">\n                            <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.eeUmts || (depth0 != null ? depth0.eeUmts : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"eeUmts","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.eeUmts || (depth0 != null ? depth0.eeUmts : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"eeUmts","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                        </div>\n                    </li>\n                    <li class=\"list-group-item lte-strength strength\">\n                        <img src=\"../../assets/images/zap.svg\" class=\"list-icon\">\n                        <label class=\"progress-label\">4G</label>\n                        <div class=\"lte-progress progress\">\n                            <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.eeLte || (depth0 != null ? depth0.eeLte : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"eeLte","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.eeLte || (depth0 != null ? depth0.eeLte : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"eeLte","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                        </div>\n                    </li>\n                </ul>\n            </details>\n        </div>\n        <div class=\"individual-result three-result\">\n            <details>\n                <summary>\n                    <div class=\"small-logo-container\">\n                        <img class=\"small-provider-logo three-logo selected\" src=\"../../assets/images/Three.png\">\n                    </div>\n                    <!-- <h3>Three</h3> -->\n                    <div class=\"provider-progress voice-progress progress\">\n                        <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.threeTotal || (depth0 != null ? depth0.threeTotal : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"threeTotal","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.threeTotal || (depth0 != null ? depth0.threeTotal : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"threeTotal","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                    </div>\n                    <div class=\"down-arrow-container\">\n                        <span class=\"down-arrow\"></span>\n                    </div>\n                </summary>\n                <ul class=\"list-group\">\n                    <li class=\"list-group-item voice-strength strength\">\n                        <img src=\"../../assets/images/megaphone.svg\" class=\"list-icon\">\n                        <label class=\"progress-label\">Voice</label>\n                        <div class=\"voice-progress progress\">\n                            <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.threeVoice || (depth0 != null ? depth0.threeVoice : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"threeVoice","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.threeVoice || (depth0 != null ? depth0.threeVoice : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"threeVoice","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                        </div>\n                    </li>\n                    <li class=\"list-group-item umts-strength strength\">\n                        <img src=\"../../assets/images/radio-tower.svg\" class=\"list-icon\">\n                        <label class=\"progress-label\">3G</label>\n                        <div class=\"umts-progress progress\">\n                            <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.threeUmts || (depth0 != null ? depth0.threeUmts : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"threeUmts","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.threeUmts || (depth0 != null ? depth0.threeUmts : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"threeUmts","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                        </div>\n                    </li>\n                    <li class=\"list-group-item lte-strength strength\">\n                        <img src=\"../../assets/images/zap.svg\" class=\"list-icon\">\n                        <label class=\"progress-label\">4G</label>\n                        <div class=\"lte-progress progress\">\n                            <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.threeLte || (depth0 != null ? depth0.threeLte : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"threeLte","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.threeLte || (depth0 != null ? depth0.threeLte : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"threeLte","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                        </div>\n                    </li>\n                </ul>\n            </details>\n        </div>\n        <div class=\"individual-result vodafone-result\">\n            <details>\n                <summary>\n                    <div class=\"small-logo-container\">\n                        <img class=\"small-provider-logo vodafone-logo selected\" src=\"../../assets/images/Vodafone.png\">\n                    </div>\n                    <!-- <h3>Vodafone</h3> -->\n                    <div class=\"provider-progress voice-progress progress\">\n                        <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.vodafoneTotal || (depth0 != null ? depth0.vodafoneTotal : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"vodafoneTotal","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.vodafoneTotal || (depth0 != null ? depth0.vodafoneTotal : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"vodafoneTotal","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                    </div>\n                    <div class=\"down-arrow-container\">\n                        <span class=\"down-arrow\"></span>\n                    </div>\n                </summary>\n                <ul class=\"list-group\">\n                    <div class=\"list-group-item voice-strength strength\">\n                        <img src=\"../../assets/images/megaphone.svg\" class=\"list-icon\">\n                        <label class=\"progress-label\">Voice</label>\n                        <div class=\"voice-progress progress\">\n                            <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.vodafoneVoice || (depth0 != null ? depth0.vodafoneVoice : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"vodafoneVoice","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.vodafoneVoice || (depth0 != null ? depth0.vodafoneVoice : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"vodafoneVoice","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                        </div>\n                    </div>\n                    <div class=\"list-group-item umts-strength strength\">\n                        <img src=\"../../assets/images/radio-tower.svg\" class=\"list-icon\">\n                        <label class=\"progress-label\">3G</label>\n                        <div class=\"umts-progress progress\">\n                            <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.vodafoneUmts || (depth0 != null ? depth0.vodafoneUmts : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"vodafoneUmts","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.vodafoneUmts || (depth0 != null ? depth0.vodafoneUmts : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"vodafoneUmts","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                        </div>\n                    </div>\n                    <div class=\"list-group-item lte-strength strength\">\n                        <img src=\"../../assets/images/zap.svg\" class=\"list-icon\">\n                        <label class=\"progress-label\">4G</label>\n                        <div class=\"lte-progress progress\">\n                            <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.vodafoneLte || (depth0 != null ? depth0.vodafoneLte : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"vodafoneLte","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.vodafoneLte || (depth0 != null ? depth0.vodafoneLte : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"vodafoneLte","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                        </div>\n                    </div>\n                </ul>\n            </details>\n        </div>\n        <div class=\"individual-result o2-result\">\n            <details>\n                <summary>\n                    <div class=\"small-logo-container\">\n                        <img class=\"small-provider-logo o2-logo selected\" src=\"../../assets/images/O2.png\">\n                    </div>\n                    <!-- <h3>O2</h3> -->\n                    <div class=\"provider-progress voice-progress progress\">\n                        <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.o2Total || (depth0 != null ? depth0.o2Total : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"o2Total","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.o2Total || (depth0 != null ? depth0.o2Total : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"o2Total","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                    </div>\n                    <div class=\"down-arrow-container\">\n                        <span class=\"down-arrow\"></span>\n                    </div>\n                </summary>\n                <ul class=\"list-group\">\n                    <div class=\"list-group-item voice-strength strength\">\n                        <img src=\"../../assets/images/megaphone.svg\" class=\"list-icon\">\n                        <label class=\"progress-label\">Voice</label>\n                        <div class=\"voice-progress progress\">\n                            <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.o2Voice || (depth0 != null ? depth0.o2Voice : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"o2Voice","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.o2Voice || (depth0 != null ? depth0.o2Voice : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"o2Voice","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                        </div>\n                    </div>\n                    <div class=\"list-group-item umts-strength strength\">\n                        <img src=\"../../assets/images/radio-tower.svg\" class=\"list-icon\">\n                        <label class=\"progress-label\">3G</label>\n                        <div class=\"umts-progress progress\">\n                            <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.o2Umts || (depth0 != null ? depth0.o2Umts : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"o2Umts","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.o2Umts || (depth0 != null ? depth0.o2Umts : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"o2Umts","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                        </div>\n                    </div>\n                    <div class=\"list-group-item lte-strength strength\">\n                        <img src=\"../../assets/images/zap.svg\" class=\"list-icon\">\n                        <label class=\"progress-label\">4G</label>\n                        <div class=\"lte-progress progress\">\n                            <div class=\"progress-bar progress-bar-striped\" role=\"progressbar\" style=\"width: "
    + alias4(((helper = (helper = helpers.o2Lte || (depth0 != null ? depth0.o2Lte : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"o2Lte","hash":{},"data":data}) : helper)))
    + "%\" aria-valuenow=\""
    + alias4(((helper = (helper = helpers.o2Lte || (depth0 != null ? depth0.o2Lte : depth0)) != null ? helper : alias2),(typeof helper === alias3 ? helper.call(alias1,{"name":"o2Lte","hash":{},"data":data}) : helper)))
    + "\" aria-valuemin=\"0\" aria-valuemax=\"100\"></div>\n                        </div>\n                    </div>\n                </ul>\n            </details>\n        </div>\n    </div>\n</li>";
},"useData":true});

this["BestForMe"]["Templates"]["results/results-postcode-list"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<div class=\"postcode-results-list\"></div>";
},"useData":true});

this["BestForMe"]["Templates"]["results/results-view"] = Handlebars.template({"compiler":[7,">= 4.0.0"],"main":function(container,depth0,helpers,partials,data) {
    return "<div class=\"overall-result\"></div>\n<div class=\"results-postcode-list list-group\"></div>";
},"useData":true});;/* ----------------------------------------- */
/*   EE Model
/* ----------------------------------------- */

/* ---   EE model  --- */

BestForMe.EEModel = Backbone.Model.extend({

    defaults: {
        strength: '',
        type: ''
    },

    voiceScore: 0,
    umtsScore: 0,
    lteScore: 0,
    totalScore: 0,

    parse : function(response, options) {
        console.log(response);
        return response;
    }

});

BestForMe.EECollection = Backbone.Collection.extend({

    model: BestForMe.EEModel,

    initialize : function(models,options) {
        this.url = options.url + options.postcode;
        console.log(options);
        console.log(this.url);
    },

    parse : function(response, options) {
        console.log(response);
        return response.layers;
    },

    voiceScore: 0,
    umtsScore: 0,
    lteScore: 0,
    volteWarning: false,
    highCapacity: false,
    lteAdvanced: true,
    dividentFreq: 0,
    totalScore: 0,

    processScore : function() {
        var me = this;
        this.each(function(tech) {
            if (tech.attributes.type === '2G') {
                me.voiceScore = tech.attributes.strength * 2;
            }
            else if (tech.attributes.type === '3G') {
                me.umtsScore = tech.attributes.strength * 2;
            }
            else if (tech.attributes.type === '4G800') {
                me.dividentFreq = tech.attributes.strength;
            }
            else if (tech.attributes.type === '4G1800') {
                me.lteScore += (tech.attributes.strength * 2);
                if ((tech.attributes.strength === 0) && (me.dividentFreq > 0)) {
                    me.lteScore = (me.dividentFreq * 2);
                    me.volteWarning = true;
                }
            }
            else if (tech.attributes.type === '4G2600') {
                if (tech.attributes.strength > 1) {
                    me.highCapacity = true;
                }
            }
            else if (tech.attributes.type === '4GPlus') {
                if (tech.attributes.strength > 1) {
                    me.lteAdvanced = true;
                }
            }

        });

        this.totalScore = (this.voiceScore + this.umtsScore + this.lteScore) / 3;

    }

});





;/* ----------------------------------------- */
/*   Three Model
/* ----------------------------------------- */

/* ---   Three model  --- */

BestForMe.ThreeModel = Backbone.Model.extend({

    defaults: {

    },

    voiceScore: 0,
    umtsScore: 0,
    lteScore: 0,
    totalScore: 0,

    parse : function(response, options) {
        console.log(response);
    }

});

BestForMe.ThreeCollection = Backbone.Collection.extend({

    model: BestForMe.ThreeModel,

    initialize : function(models,options) {
        this.url = options.url + options.postcode;
        console.log(options);
        console.log(this.url);
    },

    parse : function(response, options) {
        console.log(response.data);
        return response.data;
    }

});
;/* ----------------------------------------- */
/*   Vodafone Model
/* ----------------------------------------- */

/* ---   Vodafone model  --- */

BestForMe.Vodafone = Backbone.Model.extend({

    defaults: {
        // Manually set parameter ID so we don't depend on backbone data load order
        familyId: '',
        name: '',
        description: '',
        selected: false
    },

    initialize : function(models,options) {
        this.url = options.url;
    },

    parse : function(response, options){
        return response.technicalFamilies;
    }

});


;/* ----------------------------------------- */
/*   o2 Model
/* ----------------------------------------- */

/* ---   o2 model  --- */

BestForMe.O2 = Backbone.Model.extend({

    defaults: {
        // Manually set parameter ID so we don't depend on backbone data load order
        familyId: '',
        name: '',
        description: '',
        selected: false
    },

    initialize : function(models,options) {
        this.url = options.url;
    },

    parse : function(response, options){
        return response.technicalFamilies;
    }

});


;/* ----------------------------------------- */
/*   Ofcom Model
/* ----------------------------------------- */

/* ---   Ofcom model  --- */

BestForMe.OfcomModel = Backbone.Model.extend({

  defaults: {
    type: '',
    voiceIndoor: '',
    voiceOutdoor: '',
    umtsIndoor: '',
    umtsOutdoor: '',
    lteIndoor: '',
    lteOutdoor: '',
    provider: ''
  },

  voiceScore: 0,
  umtsScore: 0,
  lteScore: 0,
  totalScore: 0,

  initialize: function() {

  },

  parse : function(response, options) {
    var formattedUserData =  {
      voiceIndoor: response.voice_indoor,
      voiceOutdoor: response.voice_outdoor,
      umtsIndoor: response['3g_indoor'],
      umtsOutdoor: response['3g_outdoor'],
      lteIndoor: response['4g_indoor'],
      lteOutdoor: response['4g_outdoor'],
      provider: response.provider
    };
    return formattedUserData;
  },

  processScore : function() {
    if (this.attributes.voiceIndoor === "A") {
      this.voiceScore += 5;
    }
    else if (this.attributes.voiceIndoor === "G") {
      this.voiceScore += 10;
    }

    if (this.attributes.voiceOutdoor === "A") {
      this.voiceScore += 5;
    }
    else if (this.attributes.voiceOutdoor === "G") {
      this.voiceScore += 10;
    }

    if (this.attributes.umtsIndoor === "A") {
      this.umtsScore += 5;
    }
    else if (this.attributes.umtsIndoor === "G") {
      this.umtsScore += 10;
    }

    if (this.attributes.umtsOutdoor === "A") {
      this.umtsScore += 5;
    }
    else if (this.attributes.umtsOutdoor === "G") {
      this.umtsScore += 10;
    }

    if (this.attributes.lteIndoor === "A") {
      this.lteScore += 5;
    }
    else if (this.attributes.lteIndoor === "G") {
      this.lteScore += 10;
    }

    if (this.attributes.lteOutdoor === "A") {
      this.lteScore += 5;
    }
    else if (this.attributes.lteOutdoor === "G") {
      this.lteScore += 10;
    }

    if (this.voiceScore > 0) {
      this.voiceScore/=2;
    }
    if (this.umtsScore > 0) {
      this.umtsScore/=2;
    }
    if (this.lteScore > 0) {
      this.lteScore/=2;
    }

    this.totalScore = (this.voiceScore + this.umtsScore + this.lteScore) / 3;
    console.log(this.totalScore + this.get('provider'));
  }

});

BestForMe.OfcomCollection = Backbone.Collection.extend({

  model: BestForMe.OfcomModel,

  postcode: null,

  initialize : function(models,options) {
    this.url = options.url + options.postcode;
    this.postcode = options.postcode;
  },

  parse : function(response, options) {
    console.log(response);
    return response.data;
  },

  processScore : function() {
    this.each(function(provider) {
      provider.processScore();
    });
  }

});


;/* ----------------------------------------- */
/*   Postcode Model
/* ----------------------------------------- */

/* ---   Postcode model  --- */

BestForMe.PostcodeModel = Backbone.Model.extend({

  defaults: {
    postcode: null,
    postcodeEngine: null
  }

});

BestForMe.PostcodeCollection = Backbone.Collection.extend({

  model: BestForMe.PostcodeModel,

  initialize : function(models,options) {

  }

});





;/* ----------------------------------------- */
/*   Postcode Model
/* ----------------------------------------- */



/* ---   Results model  --- */

BestForMe.ResultsModel = Backbone.Model.extend({

  defaults: {
    postcode: null,
    bestProvider: null,
    eeVoice: null,
    eeUmts: null,
    eeLte: null,
    eeTotal: null,
    eeWarning: null,
    threeVoice: null,
    threeUmts: null,
    threeLte: null,
    threeTotal: null,
    threeWarning: null,
    vodafoneVoice: null,
    vodafoneUmts: null,
    vodafoneLte: null,
    vodafoneTotal: null,
    vodafoneWarning: null,
    o2Voice: null,
    o2Umts: null,
    o2Lte: null,
    o2Total: null,
    o2Warning: null
  }

});

BestForMe.ResultsCollection = Backbone.Collection.extend({

  model: BestForMe.ResultsModel,

  initialize : function(models,options) {

  }

});





;/**********************************************************************************/
/*  'Module' Data Manager for bestForMe
/**********************************************************************************/


BestForMe.BestForMeDataManager = Backbone.Marionette.Object.extend({

  // store in a app object all the data that needs to be shared with several modules (to reduce init boilerplate code)
  // empty object created by root app with this structure
  // the data manager is responsible for population the 'data' sub-object from the endpoints
  appData : null,

  // Backbone data radio channel
  // Data Manager uses it to broadcast a message that all data have been retrieved, or there was an error
  dataChannel: null,

  // Backbone auth radio channel
  // to request token refresh, and wait for new token
  authChannel: null,

  // holds the requests that could not be sent the server immediately becausw the token was invalid
  // they will be processed as soon as we get a token:updated messge from the auth channel
  requestQueue: [],

  errorHandlingInProgress: false,

  // check that all core data specific to this module have been fetched
  coreDataFetched: false,
  // all 3 collections need to be fetched for core data to be fetched
  eeFetched: false,
  threeFetched: false,
  vodafoneFetched: false,
  o2Fetched: false,
  ofcomFetched: false,
  postcode: null,

  data: {
    // if the data is 'core', i.e. fetched directly by the app data manager on launch then the app data manager create the data structures
    ee: null,
    three: null,
    vodafone: null,
    o2: null,
    ofcom: null
  },

  /**
   * initialize - Initializes the article data manager
   *
   * @param  {type} appData main core data for BestForMe Web
   */
  initialize: function(config) {
    this.appData = config.appData;

    // listen for message from views requesting 'on-demand' data
    this.dataChannel = Backbone.Radio.channel('data');
      //this.listenTo(this.dataChannel, 'fetch:results', this.initData);
    // MM: unused here as we only load core data on start

    //this.initData();
  },

  initData: function(postcode) {
    console.log('fetching results');
    this.postcode = postcode;
    // on the empty 'bestForMe' key provided by top app, create sub object where to store the module data
    //this.appData.data.bestForMe = {};
    this.data.ee = new BestForMe.EECollection(
        null,
        {
          postcode: postcode,
          url: this.appData.endpoints.ee
        }
    );
    this.data.three = new BestForMe.ThreeCollection(
        null,
        {
          postcode: postcode,
          url: this.appData.endpoints.three
        }
    );
    this.data.vodafone = new BestForMe.Vodafone(
        null,
        {
          postcode: postcode,
          url: this.appData.endpoints.vodafone
        }
    );
      this.data.o2 = new BestForMe.O2(
          null,
          {
              postcode: postcode,
              url: this.appData.endpoints.o2
          }
      );
      this.data.ofcom = new BestForMe.OfcomCollection(
          null,
          {
              postcode: postcode,
              url: this.appData.endpoints.ofcom
          }
      );
      this.fetchCoreData();
    // get the projects from local storage
    //this.appData.data.bestForMe.projects = new BestForMe.BestForMeProjects();

  },

  /**
   * clearData - description
   *
   * @return {type}  description
   */
  clearData: function() {
    this.data.ee = null;
    this.data.three = null;
    this.data.vodafone = null;
    this.data.o2 = null;
    this.data.ofcom = null;
  },


  /**
   * fetchCoreData - fetch module specific 'core data' (= fetched on start, not on demand by views)
   *
   * @return {type}  description
   */
  fetchCoreData: function() {

    // capture 'this' for callbacks
    var me = this;

    // get the projects from local storage
    this.data.ee.fetch({
      reset: true,
      // comment out request header as we are fetching JSON from a local file
      //headers: this.appData.tokenBearerHeader,
      success: function(model, response, options) {
        var dataName = "ee";
        me.dataFetchSuccess(model, response, options, dataName);
      },
      error: function(model, response, options) {
        var dataName = "ee";
        me.dataFetchError(model, response, options, dataName);
      }
    });
/**
    // get parameters
    this.appData.data.three.fetch({
      reset: true,
      // comment out request header as we are fetching JSON from a local file
      //headers: this.appData.tokenBearerHeader,
      success: function(model, response, options) {
        var dataName = "three";
        me.dataFetchSuccess(model, response, options, dataName);
      },
      error: function(model, response, options) {
        var dataName = "three";
        me.dataFetchError(model, response, options, dataName);
      }
    });

    // get tactical families
    this.appData.data.bestForMe.vodafone.fetch({
      reset: true,
      // comment out request header as we are fetching JSON from a local file
      //headers: this.appData.tokenBearerHeader,
      success: function(model, response, options) {
        var dataName = "vodafone";
        me.dataFetchSuccess(model, response, options, dataName);
      },
      error: function(model, response, options) {
        var dataName = "vodafone";
        me.dataFetchError(model, response, options, dataName);
      }
    });

    // get technical families
    this.appData.data.bestForMe.o2.fetch({
      reset: true,
      // comment out request header as we are fetching JSON from a local file
      //headers: this.appData.tokenBearerHeader,
      success: function(model, response, options) {
        var dataName = "o2";
        me.dataFetchSuccess(model, response, options, dataName);
      },
      error: function(model, response, options) {
        var dataName = "o2";
        me.dataFetchError(model, response, options, dataName);
      }
    });
**/
    // get technical families
    this.data.ofcom.fetch({
      reset: true,
      // comment out request header as we are fetching JSON from a local file
      //headers: this.appData.tokenBearerHeader,
      success: function(model, response, options) {
        var dataName = "ofcom";
        me.dataFetchSuccess(model, response, options, dataName);
      },
      error: function(model, response, options) {
        var dataName = "ofcom";
        me.dataFetchError(model, response, options, dataName);
      }
    });

  },

  dataFetchSuccess: function(model, response, options, dataName) {

    // mark the collection that was fetched
    if (dataName === "ee") {
      this.eeFetched = true;
      console.log(model);
      //model.processScore();
        console.log(model.umtsScore);
      //console.log('PARAMETERS FETCHED!');
      //console.log(this.appData.data.bestForMe.parameters);
    }
    else if (dataName === "three") {
      this.threeFetched = true;
      //console.log('TACTICAL FAMILIES FETCHED!');
      //console.log(this.appData.data.bestForMe.tacticalFamilies);
    }
    else if (dataName === "vodafone") {
      this.vodafoneFetched = true;
      //console.log('TECHNICAL FAMILIES FETCHED!');
      //console.log(this.appData.data.bestForMe.technicalFamilies);
    }
    else if (dataName === "o2") {
      this.o2Fetched = true;
      //console.log('PROJECTS FETCHED!');
      //console.log(this.appData.data.bestForMe.projects);
    }
    else if (dataName === "ofcom") {
      //console.log(model);
      //console.log(response);
      this.ofcomFetched = true;
      //this.model.processScore();
      //model.processScore();
      //console.log(this.appData.data.ofcom);
      var comparisonEngine = new BestForMe.ComparisonEngine({
        appData: this.appData,
        data: this.data,
        postcode: this.postcode
      });
      comparisonEngine.calculateBestProvider();
    }
    
    // check whether all core data have been fetched (unless it's already set and we're fetching additional data)
    // Core data means the data we need to show any content screen, that it's not possible to fail gracefully if it does not get fetched
    if (!this.coreDataFetched) {
      this.checkCoreDataFetched();
    }
  },

  checkCoreDataFetched: function() {

    // check the individual boolean for each collection that is part of core data
    if (this.eeFetched && this.threeFetched && this.vodafoneFetched && this.o2Fetched && this.ofcomFetched) {

      this.coreDataFetched = true;

      // tell the main app all data have been fetched, so it can route to the main screen
      // SAM: I think listen to this event to know it's ok to show the parameter view or something
      // here we load locally so it does not matter but let's make it as though it's not local so it still works if they want a server
      // we must not allow the create new project button to show up until core data is loaded since all 3 above need nesting into a blank project
      // the main app data manager catches the event wo maybe it will already do the job CHECK!!
      this.dataChannel.trigger('bestForMe:core:data:fetched');
    }
  },

  /**
   * dataFetchError - description
   *
   * @param  {type} model    description
   * @param  {type} response description
   * @param  {type} options  description
   * @param  {type} dataName description
   * @return {type}          description
   */
  dataFetchError: function(model, response, options, dataName) {

    console.log('BestForMeDataManager.dataFetchError: '+dataName+', error handling in progress: '+this.errorHandlingInProgress);

    // handleError method is on ErrorHandlerMixin
    // defaultAction = true -> tell the error handler to process the action itself (most common case)
    var formattedError = this.handleError(response, options, true);  
  }

});

// Copy the errorHandler mixin methods to BestForMe.ArticleDataManager
_.extend(BestForMe.BestForMeDataManager.prototype, BestForMe.ErrorHandlerMixin);
;/**
 Engine to compare results and calculate the best option
 **/

BestForMe.ComparisonEngine = Backbone.Marionette.Object.extend({

  appData: null,

  dataChannel: null,

  resultsView: null,

  postcode: null,

  data: null,

  initialize: function(config) {
    this.appData = config.appData;
    this.data = config.data;
    this.postcode = config.postcode;
    this.dataChannel = Backbone.Radio.channel('data');

  },

  calculateBestProvider: function() {
    var result = new BestForMe.ResultsModel();
    result.set({postcode: this.postcode});

    var threeModel = this.data.ofcom.where({provider: 'Three'});
    threeModel[0].processScore();
    var three = {
      provider: 'Three',
      score: threeModel[0].totalScore
    };
    result.set({threeVoice: threeModel[0].voiceScore * 10});
    result.set({threeUmts: threeModel[0].umtsScore * 10});
    result.set({threeLte: threeModel[0].lteScore * 10});
    result.set({threeTotal: threeModel[0].totalScore * 10});

    //providers.add(three);
    //var three = (this.appData.data.three.totalScore + ofcomThree.totalScore());
    //var three =  ofcomThree.totalScore;
    var eeModel = this.data.ofcom.where({provider: 'EE'});
    eeModel[0].processScore();
    var ee = {
      provider: 'EE',
      score: eeModel[0].totalScore
    };
    result.set({eeVoice: eeModel[0].voiceScore * 10});
    result.set({eeUmts: eeModel[0].umtsScore * 10});
    result.set({eeLte: eeModel[0].lteScore * 10});
    result.set({eeTotal: eeModel[0].totalScore * 10});

    //providers.add(ee)
    //var ee = (this.appData.data.ee.totalScore + ofcomEE.totalScore());
    //var ee = ofcomEE.totalScore;
    var vodafoneModel = this.data.ofcom.where({provider: 'Vodafone'});
    vodafoneModel[0].processScore();
    var vodafone = {
      provider: 'Vodafone',
      score: vodafoneModel[0].totalScore
    };
    result.set({vodafoneVoice: vodafoneModel[0].voiceScore * 10});
    result.set({vodafoneUmts: vodafoneModel[0].umtsScore * 10});
    result.set({vodafoneLte: vodafoneModel[0].lteScore * 10});
    result.set({vodafoneTotal: vodafoneModel[0].totalScore * 10});

    //providers.add(vodafone);
    //var vodafone = (this.appData.data.vodafone.totalScore + ofcomVodafone.totalScore());
    //var vodafone = ofcomVodafone.totalScore;
    var o2Model = this.data.ofcom.where({provider: 'O2'});
    o2Model[0].processScore();
    var o2 = {
      provider: 'O2',
      score: o2Model[0].totalScore
    };
    result.set({o2Voice: o2Model[0].voiceScore * 10});
    result.set({o2Umts: o2Model[0].umtsScore * 10});
    result.set({o2Lte: o2Model[0].lteScore * 10});
    result.set({o2Total: o2Model[0].totalScore * 10});

    //providers.add(o2);
    var providers = [three, ee, vodafone, o2];
    //var o2 = (this.appData.data.o2.totalScore + ofcomO2.totalScore());
    //var o2 = ofcomO2.totalScore;

    providers.sort(function(a, b){
      return b.score - a.score;
    });

    var bestProviderString = providers[0].provider;

    for (var i = 1; i < 4; i++) {
      if (providers[0].score === providers[i].score) {
        if (i === 4) {
          bestProviderString = "Any Provider";
        }
        else {
          bestProviderString = bestProviderString + ' Or ' + providers[i].provider;
        }
      }
    }
    result.set({bestProvider: bestProviderString});

    //this.data.ofcom.comparator = function( model ) {
    //  return model.totalScore;
    //};

    this.appData.data.results.add(result);
    console.log(this.appData.data.results.models);
    console.log(this.appData.data.results);
    //console.log(this.data.ofcom);

    //this.data.ofcom.sort(function(a, b){
    //  return b.totalScore - a.totalScore;
    //});

    this.dataChannel.trigger('comparison:complete', this.data.ofcom.postcode);
    /** cant exist here, outside namespace. Pass to object instead **/
    //this.resultsView = new BestForMe.ResultsView({
    //  appData: this.appData,
    //  results: providers[0]
    //});
   // this.showChildView('results', this.resultsView);
  }

});;/**
 Engine to hold data managers for individual postcodes
 **/

BestForMe.PostcodeEngine = Backbone.Marionette.Object.extend({

  appData: null,

  dataChannel: null,

  postcodeCollection: null,

  initialize: function(config) {
    console.log('initpostcodeengine');
    this.appData = config.appData;
    this.postcodeCollection = config.postcodes;
    this.dataChannel = Backbone.Radio.channel('data');
  },

  fetchData: function() {
    var me = this;
    this.postcodeCollection.each(function(provider) {
      var postcodeDataManager = new BestForMe.BestForMeDataManager({
        appData: me.appData
      });
      console.log(provider.postcode);
      postcodeDataManager.initData(provider.get('postcode'));
      provider.set({postcodeEngine: postcodeDataManager});
    });
    console.log(this.postcodeCollection);
  },

  something: function() {
    if (this.appData.modules.bestForMe) {
      this.bestForMeDataManager = new BestForMe.BestForMeDataManager({
        appData: this.appData
      });
    }
  }

});;/*******************************************************************/
/*   View: Postcode View
 /*******************************************************************/

BestForMe.PostCodeView = Backbone.Marionette.LayoutView.extend({

  template: BestForMe.Templates['postcode/postcode-view'],

  behaviors: {
    // prevent backbone from wrapping the template inside an extra div]
    // only remove the wrapper if the template has one inbuilt (i.e. a single top child element)
    removeTemplateWrapperBehavior: {
      behaviorClass: BestForMe.RemoveTemplateWrapperBehavior
    }
  },

  regions: {
    postcodeList: '.postcode-list-container',
    results: '.results-view'
  },

  // MM: cached jquery selectors for those regions that may be dynamically hidden
  ui: {
    postCodeInput: '.postcode-input',
    postCodeButton: '.postcode-button',
    postCodeAdd: '.add-button'
  },

  events: {
    'click @ui.postCodeButton': 'fetchPostCode',
    'keyup @ui.postCodeInput': 'processKey',
    'click @ui.postCodeAdd': 'addPostcode'
  },

  childEvents: {
    'fetch:postcode': 'fetchPostcode'
  },

  appData: null,

  routerChannel: null,
  dataChannel: null,
  postcodeCollection: null,
  postcodeEngine: null,

  initialize: function(options) {
    console.log('postcode view');
    this.appData = options.appData;

    // Backbone radio channels
    this.routerChannel = Backbone.Radio.channel('router');
    this.dataChannel = Backbone.Radio.channel('data');
    this.postcodeCollection = new BestForMe.PostcodeCollection();
    this.appData.data.results = new BestForMe.ResultsCollection();
  },

  onRender: function() {
    this.postcodeListView = new BestForMe.PostcodeListView({
      appData: this.appData,
      collection: this.postcodeCollection
    });
    this.showChildView('postcodeList', this.postcodeListView);
    this.resultsView = new BestForMe.ResultsView({
      appData: this.appData,
      data: this.postcodeCollection
    });
    this.showChildView('results', this.resultsView);
  },


  addPostcode: function() {
    var postcode = this.ui.postCodeInput.val();
    var postcodeModel = new BestForMe.PostcodeModel();
    postcodeModel.set({postcode: postcode});
    this.postcodeCollection.add(postcodeModel);
  },

  fetchPostCode: function() {
    if (this.postcodeCollection.length < 1) {
      swal("Please enter a postcode");
    }
    else {
      //this.appData.data.results = "";
      this.postcodeEngine = new BestForMe.PostcodeEngine({
        appData: this.appData,
        postcodes: this.postcodeCollection
      });
      this.postcodeEngine.fetchData();
    }
  },

  processKey: function(e) {
    console.log(e);
    if (e.which === 13) {
      this.dataChannel.trigger('fetch:results', this.ui.postCodeInput.val());
    }
  }

});

_.extend(BestForMe.PostCodeView.prototype, BestForMe.ChangeTitleMixin);


;/**
 * Postcode Item View
 */

BestForMe.PostcodeItemView = Backbone.Marionette.ItemView.extend({

  template: BestForMe.Templates['postcode/postcode-item'],

  ui: {
    clearBtn: '.clear-btn'
  },

  events: {
    'click @ui.clearBtn': 'clearPostcode'
  },

  appData: null,

  initialize: function(options) {
    this.appData = options.appData;
  },

  templateHelpers: function() {
    return {
      code: null
    };
  },

  clearPostcode: function() {
    this.triggerMethod('remove:postcode');
  }

});

/*******************************************************************/
/*   View: Postcode List View
/*******************************************************************/

BestForMe.PostcodeListView = Backbone.Marionette.CompositeView.extend({

  template: BestForMe.Templates['postcode/postcode-list'],

  childView: BestForMe.PostcodeItemView,

  childViewContainer: '.postcode-tag-list',

  behaviors: {
    // prevent backbone from wrapping the template inside an extra div]
    removeTemplateWrapperBehavior: {
      behaviorClass: BestForMe.RemoveTemplateWrapperBehavior
    }
  },

  ui: {

  },

  events: {

  },

  childEvents:  {
    'remove:postcode': 'clearPostcode'
  },

  collectionEvents: {
    // MM: need to disable the collection event auto-rerender as it renders a new param twice, possibley confused by adding it then saving the project
    //"reset": "render",
    //"add": "render",
    "remove": "render",
    "change": "render"
  },

  appData: null,

  initialize: function(options) {
    this.appData = options.appData;
  },

  clearPostcode: function(childView) {
    this.collection.remove(childView.model);
    this.triggerMethod("fetch:postcode");
  }

});;/*******************************************************************/
/*   View: Postcode View
 /*******************************************************************/

BestForMe.ResultsView = Backbone.Marionette.LayoutView.extend({

  template: BestForMe.Templates['results/results-view'],

  behaviors: {
    // prevent backbone from wrapping the template inside an extra div]
    // only remove the wrapper if the template has one inbuilt (i.e. a single top child element)
    removeTemplateWrapperBehavior: {
      behaviorClass: BestForMe.RemoveTemplateWrapperBehavior
    }
  },

  // MM: cached jquery selectors for those regions that may be dynamically hidden
  ui: {

  },

  events: {

  },

  regions: {
    overallResult: '.overall-result',
    resultsList: '.results-postcode-list'
  },

  appData: null,

  results: null,

  routerChannel: null,
  dataChannel: null,

  provider: null,

  resultsPostcodeView: null,
  overallResultView: null,

  initialize: function(options) {
    console.log('results view');
    this.appData = options.appData;
    this.results = options.data;
    // Backbone radio channels
    this.routerChannel = Backbone.Radio.channel('router');
    this.dataChannel = Backbone.Radio.channel('data');
    this.listenTo(this.dataChannel, 'comparison:complete', this.showOverallResult);
  },

  templateHelpers: function() {
    return {
      provider: this.provider
    };
  },

  showOverallResult: function(postcode) {
    //console.log(this.appData.data.results);
    //var bestProvider = this.appData.data.results.where({postcode: postcode});
    //console.log(bestProvider);
    //this.provider = bestProvider[0].get('bestProvider');
    //this.render();
    this.calculateOverallResult();
    this.resultsPostcodeView = new BestForMe.PostcodeResultList({
      appData: this.appData,
      collection: this.appData.data.results
    });
    this.showChildView('resultsList', this.resultsPostcodeView);
  },

  calculateOverallResult: function() {
    var eeTotal = 0;
    var threeTotal = 0;
    var vodafoneTotal = 0;
    var o2Total = 0;
    this.appData.data.results.each(function (result) {
      eeTotal += result.get('eeTotal');
      threeTotal += result.get('threeTotal');
      vodafoneTotal += result.get('vodafoneTotal');
      o2Total += result.get('o2Total');
    });
    var numberOfPostcodes = this.appData.data.results.length;
    eeTotal = eeTotal / numberOfPostcodes;
    threeTotal = threeTotal / numberOfPostcodes;
    vodafoneTotal = vodafoneTotal / numberOfPostcodes;
    o2Total = o2Total / numberOfPostcodes;

    var ee = {
      provider: "EE",
      score: eeTotal,
      selected: false
    };

    var three = {
      provider: "Three",
      score: threeTotal,
      selected: false
    };

    var vodafone = {
      provider: "Vodafone",
      score: vodafoneTotal,
      selected: false
    };

    var o2 = {
      provider: "O2",
      score: o2Total,
      selected: false
    };

    var providers = [three, ee, vodafone, o2];
    //var o2 = (this.appData.data.o2.totalScore + ofcomO2.totalScore());
    //var o2 = ofcomO2.totalScore;

    providers.sort(function(a, b){
      return b.score - a.score;
    });

    var bestProviderString = providers[0].provider;
    providers[0].selected = true;

    for (var i = 1; i < 4; i++) {
      if (providers[0].score === providers[i].score) {
        if (i === 4) {
          bestProviderString = "Any Provider";
          providers[i].selected = true;
        }
        else {
          bestProviderString = bestProviderString + ' Or ' + providers[i].provider;
          providers[i].selected = true;
        }
      }
    }
    this.overallResultView = new BestForMe.OverallResultView({
      appData: this.appData,
      result: bestProviderString,
      providers: providers
    });
    this.showChildView('overallResult', this.overallResultView);
  }

});

_.extend(BestForMe.ResultsView.prototype, BestForMe.ChangeTitleMixin);


;/**
 * Postcode Item View
 */

BestForMe.PostcodeResultItem = Backbone.Marionette.ItemView.extend({

  template: BestForMe.Templates['results/results-postcode-item'],

  ui: {

  },

  events: {

  },

  appData: null,

  initialize: function(options) {
    this.appData = options.appData;
    console.log(this.model);
  },

  templateHelpers: function() {
    return {
      code: null
    };
  },

  onAttach: function() {
    $( ".progress-bar" ).each(function( index ) {
      var value = $( this ).attr("aria-valuenow");
      var colour = '';
      if (value > 60) {
        colour = 'green';
      }
      else if ((value > 25) && (value <= 60)) {
        colour = 'yellow';
      }
      else if (value < 25) {
        colour = 'red';
      }
      $( this ).addClass(colour);
    });
  }

});

/*******************************************************************/
/*   View: Postcode List View
/*******************************************************************/

BestForMe.PostcodeResultList = Backbone.Marionette.CompositeView.extend({

  template: BestForMe.Templates['results/results-postcode-list'],

  childView: BestForMe.PostcodeResultItem,

  childViewContainer: '.postcode-results-list',

  behaviors: {
    // prevent backbone from wrapping the template inside an extra div]
    removeTemplateWrapperBehavior: {
      behaviorClass: BestForMe.RemoveTemplateWrapperBehavior
    }
  },

  ui: {

  },

  events: {

  },

  collectionEvents: {
    // MM: need to disable the collection event auto-rerender as it renders a new param twice, possibley confused by adding it then saving the project
    //"reset": "render",
    //"add": "render",
    //"remove": "render"
    "change": "render"
  },

  appData: null,

  initialize: function(options) {
    this.appData = options.appData;
    console.log(this.collection);
  }

});;/**
 * Overall Result Item View
 */

BestForMe.OverallResultView = Backbone.Marionette.ItemView.extend({

  template: BestForMe.Templates['results/overall-result'],

  ui: {

  },

  events: {

  },

  appData: null,

  providers: null,

  result: null,

  initialize: function(options) {
    this.appData = options.appData;
    this.result = options.result;
    this.providers = options.providers;
  },

  templateHelpers: function() {
    console.log(this.providers);
    var threeSelected, eeSelected, vodafoneSelected, o2Selected = false;
    for (var i = 0; i < 4; i++) {
      if (this.providers[i].provider === "EE") {
        eeSelected = this.providers[i].selected;
      }
      else if (this.providers[i].provider === "Three") {
        threeSelected = this.providers[i].selected;
      }
      else if (this.providers[i].provider === "Vodafone") {
        vodafoneSelected = this.providers[i].selected;
      }
      else if (this.providers[i].provider === "O2") {
        o2Selected = this.providers[i].selected;
      }
    }
    return {
      overallBestProvider: this.result,
      ee: eeSelected,
      three: threeSelected,
      vodafone: vodafoneSelected,
      o2: o2Selected
    };
  }

});;BestForMe.Router = Backbone.Marionette.AppRouter.extend({

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
    //'parameter-guide/:projectId': 'showParameterScreen',
    // error screen if page not found
    // call it ourselves
    'pagenotfound(/)': 'showPageNotFound',
    // or the user types wrong link in navbar of link contains non-existent route
    '*path'  : 'showPageNotFound'
  },

  // keep track whether the app core data has been fetched
  // this is to handle the case when the user is trying to reload on a specific view, we need to fetche the wqit and wait before rendering the view
  appDataFetched: true,

  // list all the routes that are allowed before data is fetched
  // MM: !!! in execute method 'name' is not the name of the route but the name of the callback method!!! so test on it
  routesAllowedBeforeDataFetched: [
    'showLoadingScreen',
    'showErrorScreen',
    'showPageNotFound',
      'showHomeScreen'
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
      console.log("router init");
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
    this.appData = config.appData;

    // radio channel used to tell the header which landing page should be active in the nav
    this.routerChannel = Backbone.Radio.channel('router');

    // init applayout since it may be used by several routes
    this.appLayout = new BestForMe.AppLayout({
      appData: this.appData
    });
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
   //this.checkAppLayoutRendered();
   //this.appLayout.showLoadingScreen();
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
      console.log('RouterController.showHomeScreen: AppLayout already rendered? ' + this.appLayoutRendered);
      this.checkAppLayoutRendered();
      this.appLayout.showHomeScreen();
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
  bestForMeDataManager: null,
  // module specific core data
  bestForMeCoreDataFetched: false,

  /* --- Initialisation code  --- */

  initialize: function(config) {
    this.appData = config.appData;

    // listen for message from views requesting data
    // listen for message from module data managers telling they have fetched their data
    this.dataChannel = Backbone.Radio.channel('data');


    // create data structures (collections and models) with endpoint urls
    this.initData();
  },

  initData: function() {
    //this.bestForMeCoreDataFetched = true;
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
        var postCodeView = new BestForMe.PostCodeView({
            appData: this.appData
        });
        this.showChildView('main', postCodeView);
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
        eeEndpoint: 'http://maps.ee.co.uk/all?brand=ee&tab=newajaxcoverage&q=',
        threeEndpoint: 'http://www.three.co.uk/rig/coverageandoutages?postcode=',
        vodafoneEndpoint: '',
        o2Endpoint: '',
        ofcomEndpoint: 'https://ofcomapi.samknows.com/mobile-coverage-pc?postcode=',
        ofcomAddress: 'https://ofcomapi.samknows.com/addresses?postcode=',
        debug: 'true',
        title: 'Best For Me',
        // tells which shared/homepage bestForMe features are enabled in this build
        features: {
            // special mode to bypass the login and get data locally, no server calls at all, after initial load, the webapp runs by itself
            localMode: 'true'
        },
        // tells which bestForMe modules are enabled in this build
        modules: {
            bestForMe: ''
        }
    };

    var bestForMe = new BestForMe(bestForMeConfig);

    // MM TEMP TEST: comment out to clear the test projects
    //localStorage.clear();

    bestForMe.start();

});
