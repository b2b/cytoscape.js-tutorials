"use strict";

document.addEventListener('DOMContentLoaded', function() {
  var mainUser;
  var cy = cytoscape({
    container: document.getElementById('cy'),
    style: [
      {
        selector: 'node',
        style: {
          'label': 'data(username)',
          'width': 'mapData(followerCount, 0, 400, 50, 150)',
          'height': 'mapData(followerCount, 0, 400, 50, 150)',
          'background-color': '#02779E',
          'background-opacity': 'mapData(tweetCount, 0, 2000, 0.1, 1)'
        }
      }
    ]
  });
  var concentricLayout = cy.makeLayout({
    name: 'concentric',
    concentric: function(node) {
      return 10 - node.data('level');
    },
    levelWidth: function() {
      return 1;
    },
    animate: false
  });
  var forceLayout = cy.makeLayout({
    name: 'cose',
    animate: false
  });

  function addToGraph(targetUser, followers, level) {
    // target user
    if (cy.getElementById(targetUser.id_str).empty()) {
      // getElementById is faster here than a selector
      // does not yet contain user
      cy.add(twitterUserObjToCyEle(targetUser, level));
    }

    // that user's followers
    var targetId = targetUser.id_str; // saves calls while adding edges
    cy.batch(function() {
      followers.forEach(function(twitterFollower) {
        if (cy.getElementById(twitterFollower.id_str).empty()) {
          // does not yet contain follower
          // level + 1 since followers are 1 degree out from the main user
          cy.add(twitterUserObjToCyEle(twitterFollower, level + 1));
          cy.add({
            data: {
              id: 'follower-' + twitterFollower.id_str,
              source: twitterFollower.id_str,
              target: targetId
            }
          });
        }
      });
    });
  }

  var concentricButton = document.getElementById('concentricButton');
  concentricButton.addEventListener('click', function() {
    concentricLayout.run();
  });

  var forceButton = document.getElementById('forceButton');
  forceButton.addEventListener('click', function() {
    forceLayout.run();
  });

  var submitButton = document.getElementById('submitButton');
  submitButton.addEventListener('click', function() {
    cy.elements().remove();
    var userInput = document.getElementById('twitterHandle').value;
    if (userInput) {
      // Default value
      mainUser = userInput;
    } else {
      // default value
      mainUser = 'cytoscape';
    }

    // add first user to graph
    getTwitterPromise(mainUser).then(function(then) {
      addToGraph(then.user, then.followers, 0);

      // add followers
      try {
        var options = {
          maxLevel: 4,
          usersPerLevel: 3,
          layout: concentricLayout
        };
        addFollowersByLevel(1, options);
      } catch (error) {
        console.log(error);
      }
    });
  });

  cy.on('select', 'node', function(event) {
    var target = event.cyTarget;
    target.qtip({
      content: {
        text: qtipText(target),
        title: target.data('fullName')
      },
      style: {
        classes: 'qtip-bootstrap'
      }
    });
  });

  /**
   * Get followers for the top three users (ranked by followers) at each level.
   *
   * Levels are degrees from the initial node.
   * Example: user specifies 'cytoscape' as the initial node. Cytoscape's followers
   * are level=1, followers of cytoscape's followers are level=2, etc.
   *
   * @param {number} level The level of the graph being added to
   * @param {object} options Constant options for addFollowersByLevel
   * @param {number} options.maxLevel The deepest level to add followers to (Main user's followers are at level=1)
   * @param {number} options.usersPerLevel Number of users to add followers at each level
   * @param {function} options.graphFunc Function passed to add JSON data to graph after Promise completes
   */
  function addFollowersByLevel(level, options) {
    var followerCompare = function(a, b) {
      return a.data('followerCount') - b.data('followerCount');
    };

    var topFollowers = cy.nodes()
        .filter('[level = ' + level + ']')
        .sort(followerCompare);

    var topFollowerPromises = function(sortedFollowers) {
      var topFollowerPosition = sortedFollowers.length - 1;
      var promiseArr = [];
      for (var i = 0; i < options.usersPerLevel; i++) {
        if (sortedFollowers[topFollowerPosition - i]) {
          // remember that sortedFollowers is an array of cytoscape elements
          // NOT an array of usernames (hence accessing username with .data())
          var user = sortedFollowers[topFollowerPosition - i].data('username');
          var individualPromise = Promise.all(getDataPromises(user));
          promiseArr.push(individualPromise);
        }
      }
      return promiseArr;
    };

    var quit = false;
    if (level < options.maxLevel && !quit) {
      var followerPromises = topFollowerPromises(topFollowers);
      Promise.all(followerPromises)
        .then(function(userAndFollowerData) {
          // all data returned successfully!
          for (var i = 0; i < userAndFollowerData.length; i++) {
            var twitterData = userAndFollowerData[i];
            if (twitterData.user.error || twitterData.followers.error) {
              // error occured, such as rate limiting
              var error = twitterData.user.error ? twitterData.user : twitterData.followers;
              console.log('Error occured. Code: ' + error.status + ' Text: ' + error.statusText);
              if (error.status === 429) {
                // rate limited, so stop sending requests
                quit = true;
              }
            } else {
              addToGraph(twitterData.user, twitterData.followers, level);
            }
          }
          addFollowersByLevel(level + 1, options);
        }).catch(function(err) {
          console.log('Could not get data. Error message: ' + err);
        });
    } else {
      // reached the final level, now let's lay things out
      options.layout.run();
    }
  }
});

function qtipText(node) {
  var twitterLink = '<a href="http://twitter.com/' + node.data('username') + '">' + node.data('username') + '</a>';
  var following = 'Following ' + node.data('followingCount') + ' other users';
  var location = 'Location: ' + node.data('location');
  var image = '<img src="' + node.data('profilePic') + '" style="float:left;width:48px;height:48px;">';
  var description = '<i>' + node.data('description') + '</i>';

  return image + twitterLink + '<br>' + location + '<br>' + following + '<p><br>' + description + '</p>';
}

function getTwitterPromise(targetUser) {
  // var userPromise = $.ajax({
  //   url: 'http://localhost:8080/cache/' + targetUser + '-user.json',
  //   type: 'GET',
  //   dataType: 'json'
  // });

  // var followersPromise = $.ajax({
  //   url: 'http://localhost:8080/cache/' + targetUser + '-followers.json',
  //   type: 'GET',
  //   dataType: 'json'
  // });

  // return Promise.all(userPromise, followersPromise)
  //   .then(function(then) {
  //     return {
  //       user: then[0],
  //       followers: then[1]
  //     };
  //   });

  // Express API
  // Will use cached data if available
  var expressUserPromise = $.ajax({
    async: true,
    crossDomain: true,
    url: 'http://localhost:3000/twitter/user',
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    data: {
      username: targetUser
    }
  });

  var expressFollowersPromise = $.ajax({
    async: true,
    crossDomain: true,
    url: 'http://localhost:3000/twitter/followers',
    method: "POST",
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    data: {
      username: targetUser
    }
  });
  return Promise.all([expressUserPromise, expressFollowersPromise])
    .then(function(then) {
      return {
        user: then[0],
        followers: then[1]
      };
    });
}

function twitterUserObjToCyEle(user, level) {
  return {
    data: {
      id: user.id_str,
      username: user.screen_name,
      followerCount: user.followers_count,
      tweetCount: user.statuses_count,
      // following data for qTip
      fullName: user.name,
      followingCount: user.friends_count,
      location: user.location,
      description: user.description,
      profilePic: user.profile_image_url,
      level: level
    }
  };
}
