var http = require('http')
    , url = require("url")
    , fs = require('fs')
    , express = require('express')
    , twitter  = require("ntwitter")
    , redis = require('redis');

var app = express();

app.configure( 
    function() {
      app.set('port', process.env.PORT || 5000);
      app.use(app.router);
      app.enable("jsonp callback");
    }
);

/* Socket.io setup */

server = http.createServer(app).listen(app.get('port'), function(){
    console.log("Express server listening on port " + app.get('port'));
});

io = require('socket.io').listen(server);

/* Establish Twitter connection */

var twitter = new twitter({
  consumer_key: process.env.consumer_key,
  consumer_secret: process.env.consumer_secret,
  access_token_key: process.env.access_token_key,
  access_token_secret: process.env.access_token_secret
});

/* Establisn Redis connection (using Redis Cloud) for caching */

if (process.env.REDISCLOUD_URL) {
  var redisURL = url.parse(process.env.REDISCLOUD_URL);
  var redis = redis.createClient(redisURL.port, redisURL.hostname, {no_ready_check: true});
  redis.auth(redisURL.auth.split(":")[1]);
} else {
  var redis = redis.createClient();
}

redis.on("error", function (err) {
    console.log("Redis client error: ", err);
});

/* Server */

app.get('/search/*', function(request, response) {
  // Set cross domain headers
  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Headers", "X-Requested-With");

  var searchphrase = request.params[0].split('/').join(' ');
  if (request.query.url !== undefined && request.query.url.length > 0) {
    searchphrase += ' ' + request.query.url;
  }
  // Check if cached
  var redisKey = searchphrase.replace(' ', '');
  if (searchphrase.length > 0) {
    redis.get(redisKey, function (err, result) {
      if (err) { console.log('Error: '+err); return; }
      if (result) {
        response.json(JSON.parse(result));
      } else {
        // No result, get search from Twitter and save to Redis
        // console.log("Searching for: "+searchphrase);
        twitter.search(searchphrase.trim(), {include_entities: true}, function(err, data) {
          // console.log("Error:"+err);
          // console.log("Data: "+JSON.stringify(data));
          if (data !== undefined && data.statuses.length > 0) {
            redis.setex(redisKey, 60, JSON.stringify(data));
            response.json(data);
          } else {
            response.write("No data. Error: "+err);
            response.end();
          }
        });
      }
        
    });
  } else {
    response.end('');
  }
});

/* Heroku exception */
if (process.env.REDISCLOUD_URL) {
  io.configure(function () { 
    io.set("transports", ["xhr-polling"]); 
    io.set("polling duration", 10); 
  });
}

io.sockets.on('connection', function(socket) {
  socket.on('stream', function(searchPhrase) {
    twitter.stream('statuses/filter', { track: [searchPhrase] },
      function(stream) {
        stream.on('error', function(error, code) {
          console.log("My error: " + error + ": " + code);
        });
        stream.on('data', function(tweet) {
            socket.emit('tweet', tweet);
        });
      }
    );
  });
});

app.get(/^.*$/, 
  function(request, response) {
    response.redirect('http://hop.ie/tweets/');
  }
);

console.log('Server running at http://127.0.0.1:5000/');