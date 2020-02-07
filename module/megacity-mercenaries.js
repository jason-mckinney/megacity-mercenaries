// Import Modules
import { MegacityItemSheet } from "./item-sheet.js";
import { MegacityActorSheet } from "./actor-sheet.js";
import { measureDistance } from "./canvas.js";

/* -------------------------------------------- */
/*  Foundry VTT Initialization                  */
/* -------------------------------------------- */

Hooks.once("init", async function() {
  game.getAttributeValue = getAttributeValue;
  game.megacityRoll = megacityRoll;

	/**
	 * Set an initiative formula for the system
	 * @type {String}
	 */
	CONFIG.initiative.formula = "2d10";

  // Register sheet application classes
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("megacity-mercenaries", MegacityActorSheet, { makeDefault: true });
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("megacity-mercenaries", MegacityItemSheet, {makeDefault: true});

  Handlebars.registerHelper("calcMaxHealth", function(data) {
    return 9 
      + data.body.value * 2 
      + data.will.value;
  });
  
  Handlebars.registerHelper("calcSpeed", function(data) {
    return 4 
      + (data.body.value >= 4 ? 1 : 0)
      + (data.agility.value >= 4 ? 1 : 0);
  });

  Handlebars.registerHelper("calcWillDefense", function(data) {
    return 10 
      + data.will.value * 2;
  });

  Handlebars.registerHelper("calcMeleeDefense", function(data) {
    return 10
      + data.agility.value
      + (data.attributes.melee ? data.attributes.melee.value : 0);
  });

  Handlebars.registerHelper("calcArmor", function(data) {
    return Math.min(12, data.armor.value);
  });
});

Hooks.on("canvasInit", function() {
  SquareGrid.prototype.measureDistance = measureDistance;
});

//initiative command
Hooks.on("chatMessage", (chatlog, message) => {
  let [command, m] = parse(message);

  switch (command) {
    case "initiative":
      const token = canvas.tokens.get(ChatMessage.getSpeaker().token);
      if (!token) { break; }

      let attr = message.replace(/\/i(?:nitiative)?/, "").trim();
      attr = getAttributeValue(token.actor, attr);
      
      game.combat.rollInitiative(game.combat.getCombatantByToken(token.id)._id, CONFIG.initiative.formula + "+" + attr);

      return false;
  }

  return true;
});

//dice roller attribute parser
Hooks.on("chatMessage", (chatlog, message) => {
  let [command, m] = parse(message);
  switch (command) {
    case "roll": case "gmroll": case "blindroll": case "selfroll":
      let formula = message.replace(/\/r(?:oll)?|\/gmr(?:oll)|\/b(?:lind)?r(?:oll)?|\/s(?:elf)?r(?:oll)?/, "").trim();
      
      megacityRoll(formula, {rollMode:command});
      return false;
  }

  return true;
});

function getAttributeValue(actor, attribute) {
  let attr = null;

  switch(attribute) {
    case "body": case "agility": case "mind": case "senses": case "guild": case "will":
      attr = actor.data.data[attribute];
      return attr ? attr.value : 0;
    default: 
      attr = actor.data.data.attributes[attribute] ;
      return attr ? attr.value : 0;   
  }
}

function megacityRoll (formula, {targetActor=null, rollMode=game.settings.get("core", "rollMode"), chatData={}, display=true}={}) {
  const speaker = ChatMessage.getSpeaker();
  const actor = targetActor ? targetActor : game.actors.get(speaker.actor);
  const token = canvas.tokens.get(speaker.token);
  const character = game.user.character;
  let isHard = false;

  formula = formula.replace(/#\S*/g, "").trim();

  //actor attribute
  let match = formula.match(/\@[^+\-\/*\s]*/g);
  if (match) {
    match.forEach((attr) => {
      const value = actor ? getAttributeValue(actor, attr.substring(1)) : 0;
      formula = formula.replace(attr, value);
    });
  }
  
  //token attribute
  match = formula.match(/\$[^+\-\/*\s]*/g);
  if (match) {
    match.forEach((attr) => {
      const value = token ? getAttributeValue(token.actor, attr.substring(1)) : 0;
      formula = formula.replace(attr, value);
    });
  }

  //character attribute
  match = formula.match(/\&[^+\-\/*\s]*/g);
  if (match) {
    match.forEach((attr) => {
      const value = character ? getAttributeValue(character, attr.substring(1)) : 0;
      formula = formula.replace(attr, value);
    });
  }

  const roll = new Roll(formula, {});
  roll.roll();
  if (display) {
    roll.toMessage({chatData}, {rollMode:rollMode, create:true});
  }

  if (!actor && formula.includes('@')) {
    ui.notifications.warn('A token attribute was specified in your roll, but no token was selected.');
  }
  return roll;
}

function parse(message) {
  // Dice roll regex
  let formula = '([^#]*)';                  // Capture any string not starting with '#'
  formula += '(?:(?:#\\s?)(.*))?';          // Capture any remaining flavor text
  const roll = '^(\\/r(?:oll)? )';          // Regular rolls, support /r or /roll
  const gm = '^(\\/gmr(?:oll)? )';          // GM rolls, support /gmr or /gmroll
  const br = '^(\\/b(?:lind)?r(?:oll)? )';  // Blind rolls, support /br or /blindroll
  const sr = '^(\\/s(?:elf)?r(?:oll)? )';   // Self rolls, support /sr or /sroll
  const initiative = '^(\\/i(?:nitiative)? )';
  const any = '([^]*)';                     // Any character, including new lines
  const word = '\\S+';

  // Define regex patterns
  const patterns = {
    "roll": new RegExp(roll+formula, 'i'),
    "gmroll": new RegExp(gm+formula, 'i'),
    "blindroll": new RegExp(br+formula, 'i'),
    "selfroll": new RegExp(sr+formula, 'i'),
    "initiative": new RegExp(initiative+word+'$', 'i'),
    "ic": new RegExp('^(\/ic )'+any, 'i'),
    "ooc": new RegExp('^(\/ooc )'+any, 'i'),
    "emote": new RegExp('^(\/em(?:ote)? )'+any, 'i'),
    "whisper": new RegExp(/^(@|\/w(?:hisper)?\s{1})(\[(?:[^\]]+)\]|(?:[^\s]+))\s+([^]*)/, 'i'),
    "none": new RegExp('()'+any, 'i')
  };

  // Iterate over patterns, finding the first match
  let c, rgx, match;
  for ( [c, rgx] of Object.entries(patterns) ) {
    match = message.match(rgx); 
    if ( match ) return [c, match];
  }
  return [null, null];
}

export const _onCombatantControl = function (event) {
  console.log("Bip!");
}