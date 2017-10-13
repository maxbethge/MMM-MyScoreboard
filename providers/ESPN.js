/*

  -------------------------------------
    Provider for ESPN Scoreboard Data
  -------------------------------------

  Provides scores for
    NCAAF (College Football, FBS Division)
    NBA (National Basketball Association)

  Data API also provides scoreboard data for MANY other
  leagues, not currently supported.  NCAAM (Men's
  College Basketball) support to come in the near future.

  You can get an idea of what sports and leagues are
  supported here:
  http://www.espn.com/static/apis/devcenter/io-docs.html

  Documentation for the feed can be found here:
  http://www.espn.com/static/apis/devcenter/docs/scores.html#parameters

  ESPN has several different APIs for various sports data,
  most of which need an API key.  ESPN no longer gives out
  public API keys.  The good news is the Scoreboard API does
  not require an API key. It's free and clear.  Let's not
  abuse this.  Please do not modify this to hammer the API
  with a flood of calls, otherwise it might cause ESPN to
  lock this it down.

  Data is polled on demand per league configured in the
  front end. Each time the front end makes a request for a
  particular league a request for JSON is made to ESPN's
  servers.  The front end polls every two miuntes.

*/

const request = require("request");
const moment = require("moment-timezone");
const parseJSON = require("json-parse-async");

module.exports = {

  PROVIDER_NAME: "ESPN",

  getLeaguePath: function(league) {
    switch (league) {
      case "NCAAF":
        return "football/college-football";
      case "NBA":
        return "basketball/nba";
      case "NCAAM": 
        return "basketball/mens-college-basketball";
      default:
        return null;
    }
  },

  getScores: function(league, teams, gameDate, callback) {

    var self = this;

    var url = "http://site.api.espn.com/apis/site/v2/sports/" +
      this.getLeaguePath(league) +
      "/scoreboard?dates=" + 
      moment(gameDate).format("YYYYMMDD") + "&limit=200";

    request({url: url, method: "GET"}, function(r_err, response, body) {

      if(!r_err && response.statusCode == 200) {
        
        parseJSON(body, function(p_err, content) {
          if (p_err) {
            console.log( "[MMM-MyScoreboard] " + moment().format("D-MMM-YY HH:mm") + " ** ERROR ** Couldn't parse " + league + " data for provider ESPN: " + p_err );       
          } else {
            callback(self.formatScores(league, content, teams));
          }
        });

      } else {
        console.log( "[MMM-MyScoreboard] " + moment().format("D-MMM-YY HH:mm") + " ** ERROR ** Couldn't retrieve " + league + " data for provider ESPN: " + r_err );       
      }

    });


  },

  formatScores: function(league, data, teams) {

    var self = this;
    var formattedGamesList = new Array();
    var localTZ = moment.tz.guess();

    var filteredGamesList;
    if (teams != null) { //filter to teams list

      filteredGamesList = data.events.filter(function(game) {
        return teams.indexOf(game.competitions[0].competitors[0].team.abbreviation) != -1 ||
          teams.indexOf(game.competitions[0].competitors[1].team.abbreviation) != -1;
      });

    } else { //return all games
      filteredGamesList = data.events;
    }

    //sort by start time, then by away team shortcode.
    filteredGamesList.sort(function(a,b) {
      var aTime = moment(a.competitions[0].date);
      var bTime = moment(b.competitions[0].date);

      //first sort by start time
      if (aTime.isBefore(bTime)) {
        return -1;
      }
      if (aTime.isAfter(bTime)) {
        return 1;
      }

      //start times are the same.  Now sort by away team short codes
      var aTteam = (a.competitions[0].competitors[0].homeAway == "away" ?
        a.competitions[0].competitors[0].team.abbreviation :
        a.competitions[0].competitors[1].team.abbreviation);

      var bTteam = (b.competitions[0].competitors[0].homeAway == "away" ?
        b.competitions[0].competitors[0].team.abbreviation :
        b.competitions[0].competitors[1].team.abbreviation);


      if (aTteam < bTteam) {
        return -1;
      }
      if (aTteam > bTteam) {
        return 1;
      }

      return 0;

    });


    //iterate through games and construct formattedGamesList
    filteredGamesList.forEach(function(game) {

      var status = [];
      var classes = [];

      var gameState = 0;

      /*
        Not all of ESPN's status.type.id's are supported here.
        Some are for sports that this provider doesn't yet
        support, and some are so rare that we'll likely never
        see it.  These cases are handled in the 'default' block.
      */
      switch (game.status.type.id) {
        case "0" : //TBD
          gameState = 0;
          status.push("TBD");
          break;
        case "1": //scheduled
          gameState = 0;
          status.push(moment(game.competitions[0].date).tz(localTZ).format("h:mm a"));
          break;
        case "2": //in-progress
        case "21": //beginning of period
        case "24": //overtime
          gameState = 1;
          status.push(game.status.displayClock);
          status.push(self.getPeriod(league, game.status.period));
          break;
        case "3": //final
          gameState = 2;
          status.push("Final" + self.getFinalOT(league, game.status.period));
          break;
        case "4": //forfeit
        case "9": //forfeit of home team
        case "10": //forfeit of away team
          gameState = 0;
          status.push("Forfeit");
          break;
        case "5": //cancelled
          gameState = 0;
          status.push("Cancelled");
          break;
        case "6": //postponed
          gameState = 0;
          status.push("Postponed");
          break;          
        case "7":  //delayed
        case "17": //rain delay
          gameState = 1;
          classes.push["delay"];
          status.push("Delay");
          break;
        case "8": //suspended
          gameState = 0;
          status.push("Suspended");
          break;          
        case "22": //end period
          gameState = 1;
          status.push("END");
          status.push(self.getPeriod(league, game.status.period));
          break;
        case "23": //halftime
          gameState = 1;
          status.push("HALFTIME");
          break;
        default: //Anything else, treat like a game that hasn't started yet
          gameState = 0;
          status.push(moment(game.competitions[0].date).tz(localTZ).format("h:mm a"));
          break;

      }


      var hTeamData = game.competitions[0].competitors[0];
      var vTeamData = game.competitions[0].competitors[1];

      /*
        Looks like the home team is always the first in the feed, but it also specified,
        so we can be sure.
      */
      if (hTeamData.homeAway == "away") {
        hTeamData = game.competitions[0].competitors[1];
        vTeamData = game.competitions[0].competitors[0];
      }

      /*
        WTF... 
        for NCAAF, sometimes FCS teams (I-AA) play FBS (I-A) teams.  These are known as money
        games. As such, the logos directory contains images for all of the FCS teams as well
        as the FBS teams.  Wouldn't you know it but there is a SDSU in both divisions --
        totally different schools!!!
        So we'll deal with it here.  There is an SDSU logo file with a space at the end of
        its name (e.g.: "SDSU .png" that is for the FCS team.  We'll use that abbreviation
        which will load a different logo file, but the extra space will collapse in HTML
        when the short code is displayed).

        The big irony here is that the SAME school as the FCS SDSU has a different ESPN short
        code for basketball: SDST.
      */

      if (league == "NCAAF" && hTeamData.team.abbreviation == "SDSU" && hTeamData.team.location.indexOf("South Dakota State") != -1) {
        hTeamData.team.abbreviation = "SDSU "; 
      } else if (league == "NCAAF" && vTeamData.team.abbreviation == "SDSU" && vTeamData.team.location.indexOf("South Dakota State") != -1) {
        vTeamData.team.abbreviation = "SDSU ";
      }

      formattedGamesList.push({
        classes: classes,
        gameMode: gameState,
        hTeam: hTeamData.team.abbreviation,
        vTeam: vTeamData.team.abbreviation,
        /*
          For college sports, include the shortcode in the long team name
        */
        hTeamLong: (league == "NCAAF" || league == "NCAAM" ? hTeamData.team.abbreviation + " " : "") + hTeamData.team.shortDisplayName,
        vTeamLong: (league == "NCAAF" || league == "NCAAM" ? vTeamData.team.abbreviation + " " : "") + vTeamData.team.shortDisplayName,                    
        hScore: parseInt(hTeamData.score),
        vScore: parseInt(vTeamData.score),
        status: status,
        usePngLogos: true
      });

    });

    return formattedGamesList;



  },

  getOrdinal: function(p) {

    var mod10 = p % 10;
    var mod100 = p % 100;

    if (mod10 == 1 && mod100 != 11) {
      return p + "<sup>ST</sup>";
    }
    if (mod10 == 2 && mod100 != 12) {
      return p + "<sup>ND</sup>";
    }
    if (mod10 == 3 && mod100 != 13) {
      return p + "<sup>RD</sup>";
    }
    
    return p + "<sup>TH</sup>";

  },

  getPeriod: function(league, p) {

    //check for overtime, otherwise return ordinal
    switch (league) {
      case "NCAAF":
      case "NCAAM":
      case "NBA":
        if (p == 5) {
          return "OT";
        } else if (p > 5) {
          return (p - 4) + "OT";
        }
        break;
    }
    return this.getOrdinal(p);
  },

  getFinalOT: function(league, p) {
    switch (league) {
      case "NCAAF":
      case "NCAAM":
      case "NBA":
        if (p == 5) {
          return " (OT)";
        } else if (p > 5) {
          return " (" + (p - 4) + "OT)";
        }
        break;
    } 
    return "";
  }




};