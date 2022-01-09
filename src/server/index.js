/* eslint-disable no-console */
import { io, app } from 'fullstack-system';
import fs from 'fs';
import entities from 'entities';
import { randomOf } from '@reverse/random';

let game = {
  players: [],
  timeoutTime: 0,
  gameState: {
    whiteCards: [],
    blackCards: [],
    czar: 0,
    blackCard: {},
    turnTimeLeft: null,
    playedWhiteCards: [],
    czarReady: false,
    czarHasPicked: false
  },
  started: false,
  decks: [],
  customDecks: [],
  log: []
};

let timeLeftInterval;

function addDecks(addBlackCards, addWhiteCards) {
  const defaultDecksToUse = game.decks.filter((deck) => deck.selected && !deck.custom).map((deck) => {
    return deck.codeName;
  });
  const customDecksToUse = game.decks.filter((deck) => deck.selected && deck.custom).map((deck) => {
    return deck.codeName;
  });

  const jsonContent = {
    blackCards: [],
    whiteCards: []
  };
  // Get the default decks.

  defaultDecksToUse.forEach((deckCodeName) => {
    const deckContents = fs.readFileSync(`src/server/sets/${deckCodeName}.json`);
    
    // Add the black cards.
    if(addBlackCards) {
      const blackCards = JSON.parse(deckContents).blackCards;

      for(const blackCard of blackCards) {
        blackCard.text = entities.decodeHTML(blackCard.text).replace(/_+/g, '_____');
        jsonContent.blackCards.push(blackCard);
      }
    }
    
    // Add the white cards.
    if(addWhiteCards) {
      const whiteCards = JSON.parse(deckContents).whiteCards;

      for(const whiteCard of whiteCards) {
        jsonContent.whiteCards.push(entities.decodeHTML(whiteCard));
      }
    }
  });
  // Get the custom decks.
  customDecksToUse.forEach((deckCodeName) => {
    const customDeckIndex = game.customDecks.findIndex((customDeck) => customDeck.codeName === deckCodeName);
    
    // Add the black cards.
    if(addBlackCards) {
      const blackCards = game.customDecks[customDeckIndex].blackCards;

      for(const blackCard of blackCards) {
        blackCard.text = entities.decodeHTML(blackCard.text).replace(/_+/g, '_____');
        jsonContent.blackCards.push(blackCard);
      }
    }

    // Add the white cards.
    if(addWhiteCards) {
      const whiteCards = game.customDecks[customDeckIndex].whiteCards;

      for(const whiteCard of whiteCards) {
        jsonContent.whiteCards.push(entities.decodeHTML(whiteCard));
      }
    }
  });

  // Shuffle the decks.
  // Borrowed from https://stackoverflow.com/a/2450976/10194810.
  function shuffle(array) {
    let currentIndex = array.length, randomIndex, temporaryValue;
  
    while (0 !== currentIndex) {
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex -= 1;
      temporaryValue = array[currentIndex];
      array[currentIndex] = array[randomIndex];
      array[randomIndex] = temporaryValue;
    }
    return array;
  }
  game.gameState.blackCards = shuffle(jsonContent.blackCards);
  game.gameState.whiteCards = shuffle(jsonContent.whiteCards);
}
function getPlayerIndex(username) {
  return game.players.findIndex((player) => player.username === username);
}
function resetGame() {
  // Reset game.
  game = {
    players: [],
    gameState: {
      whiteCards: [],
      blackCards: [],
      czar: 0,
      blackCard: {},
      turnTimeLeft: null,
      playedWhiteCards: [],
      czarReady: false,
      czarHasPicked: false
    },
    started: false,
    decks: [],
    customDecks: [],
    log: []
  };
  console.log('Game reset!');
}
function removePlayer(username) {
  // Remove player.
  game.players.splice(game.players.findIndex((x) => x.username === username), 1);
  io.sockets.emit('updatedGame', game);
  console.log(`Player ${username} disconnected.`);
  game.log.push(`Player ${username} disconnected.`);

  // If there is not enough people to join.
  if(game.players.length < 3 && game.started) {
    console.log('Not enough players connected. Ending game.');
    io.sockets.emit('gameEndNotEnoughPlayers');
    resetGame();
    return;
  }
  if(game.players.length === 0) {
    console.log('Room is empty. Resetting.');
    resetGame();
  }
}

io.on('connection', (socket) => {
  socket.on('newPlayer', (username) => {
    console.log(`Player ${username} connected.`);
    game.log.push(`Player ${username} connected.`);

    // Check if the username already exists.
    for(const player of game.players) {
      if(username === player.username) {
        console.log(`Player ${username} tried to join, but username already exists.`);
        socket.emit('usernameExists');
        socket.disconnect();
        return;
      }
    }
    // Add player to game.
    game.players.push({
      username: username,
      score: 0,
      hand: []
    });

    // If the player joins in an in progress game.
    if(game.started) {
      const playerIndex = getPlayerIndex(username);

      for(let cards = 0; cards < 10; cards++) {
        game.players[playerIndex].hand.push(game.gameState.whiteCards[0]);
        game.gameState.whiteCards.shift();
      }
    }

    // Get the decks.
    if(game.players.length === 1) {
      fs.readdirSync('src/server/sets/').forEach((file) => {
        const contents = fs.readFileSync(`src/server/sets/${file}`);
        const jsonContent = JSON.parse(contents);

        game.decks.push({
          name: jsonContent.name,
          codeName: jsonContent.codeName,
          official: jsonContent.official,
          custom: false,
          selected: jsonContent.codeName === 'base-set'
        });
      });
    }
    
    // Update the client states.
    io.sockets.emit('updatedGame', game);

    socket.username = username;
  });
  socket.on('updatedDecks', (decks) => {
    game.decks = decks;

    // Update the client states.
    io.sockets.emit('updatedGame', game);
  });
  socket.on('newCustomDeck', (deckFile) => {
    let customDeckJSON;

    try {
      customDeckJSON = JSON.parse(deckFile.toString('UTF8'));
    }catch(err) {
      io.sockets.emit('badCustomDeck', 'There was an error parsing the file. Make sure there is no trailing commas and try again.');
      return;
    }
    
    const hasName = customDeckJSON.name;
    const hasCodeName = customDeckJSON.codeName;
    const hasNames = hasName && hasCodeName;

    let formattedCorrectly = true;

    // Check if the deck contains a name and a codeName.
    if(!hasNames) {
      if(!hasName && !hasCodeName) {
        io.sockets.emit('badCustomDeck', 'Keys: name and codeName, were not found. Make sure you spelled the keys correctly and try again.');
      }else if(!hasName) {
        io.sockets.emit('badCustomDeck', 'Key: name, was not found. Make sure you spelled the keys correctly and try again.');
      }else if(!hasCodeName) {
        io.sockets.emit('badCustomDeck', 'Key: codeName, was not found. Make sure you spelled the keys correctly and try again.');
      }
      return;
    }

    // Check if the codename exists in another deck.
    game.decks.forEach((deck) => {
      if(deck.codeName === customDeckJSON.codeName) {
        io.sockets.emit('badCustomDeck', 'The code name you used for your deck already exists in another deck. Change the code name and try again.');
        formattedCorrectly = false;
      }
    });
    game.customDecks.forEach((deck) => {
      if(deck.codeName === customDeckJSON.codeName) {
        io.sockets.emit('badCustomDeck', 'The code name you used for your deck already exists in another deck. Change the code name and try again.');
        formattedCorrectly = false;
      }
    });
    
    if(formattedCorrectly) {
      // Add deck to deck list.
      game.decks.push({
        name: customDeckJSON.name,
        codeName: customDeckJSON.codeName,
        customDeckJSON: customDeckJSON.codeName,
        official: false,
        custom: true,
        selected: true
      });

      // Add the cards to the game.
      const newCustomDeck = {
        codeName: customDeckJSON.codeName,
        blackCards: [],
        whiteCards: []
      };

      // If there is black cards.
      if(customDeckJSON.blackCards) {
        for(const card of customDeckJSON.blackCards) {
          // Check if the card is valid and ignore if it isn't.
          if(typeof card.text === 'string' && typeof card.pick === 'number') {
            newCustomDeck.blackCards.push(card);
          }
        }
      }
      // If there is white cards.
      if(customDeckJSON.whiteCards) {
        for(const card of customDeckJSON.whiteCards) {
          // Check if the card is valid and ignore if it isn't.
          if(typeof card === 'string') {
            newCustomDeck.whiteCards.push(card);
          }
        }
      }
    }
    game.customDecks.push(newCustomDeck);
    game.log.push(`Custom Deck: ${customDeckJSON.name} added.`);

    // Send new data.
    io.sockets.emit('updatedGame', game);
  });
  socket.on('start', (timeoutTime) => {
    console.log(`Starting game with ${game.players.length} players.`);
    addDecks(true, true);

    // Deal cards.
    for(const player of game.players) {
      game.log.push(`Player ${player.username} Drawing White Cards:`);

      for(let i = 0; i < 10; i++) {
        game.log.push(`Player ${player.username} White Card #${i + 1}: ${game.gameState.whiteCards[0]}`);
        player.hand.push(game.gameState.whiteCards[0]);
        game.gameState.whiteCards.shift();
      }
    }

    // Chose black card.
    game.log.push(`Black Card in Play: ${game.gameState.blackCards[0].text}`);
    game.gameState.blackCard = game.gameState.blackCards[0];
    game.gameState.blackCards.shift();
    

    const decks = game.decks.filter((deck) => deck.selected).map((deck) => deck.name);

    game.log.push(`Starting Game with Decks: ${decks.join(' ')}.`);
    
    game.started = true;
    io.sockets.emit('updatedGame', game);

    // Set the timeout times.
    game.timeoutTime = timeoutTime;
    io.sockets.emit('roundStart', game.timeoutTime);

    console.log('Game started.');
  });
  socket.on('roundStart', (roundStartTime) => {
    const roundTime = game.timeoutTime;
    const minutes = Math.floor(roundTime / 60);
    const seconds = roundTime - minutes * 60;
    const formattedTimeLeft = `${minutes}:${String(seconds).padStart(2, '0')}`;

    game.gameState.turnTimeLeft = formattedTimeLeft;
    io.sockets.emit('updatedGame', game);

    timeLeftInterval = setInterval(() => {
      const timeLeft = Math.ceil((game.timeoutTime * 1000 - (Date.now() - roundStartTime)) / 1000);
      const minutes = Math.floor(timeLeft / 60);
      const seconds = timeLeft - minutes * 60;
      const formattedTimeLeft = `${minutes}:${String(seconds).padStart(2, '0')}`;

      game.gameState.turnTimeLeft = formattedTimeLeft;

      // Stop when zero.
      if(minutes === 0 && seconds === 0) {
        clearInterval(timeLeftInterval);
      }
      io.sockets.emit('updatedGame', game);
    }, 1000);
  });
  socket.on('playedCard', (username, cardString) => {
    // Add new object to playedWhiteCards.
    if(!game.gameState.playedWhiteCards.find((object) => {
      return object.username === username;
    })) {
      game.gameState.playedWhiteCards.push({
        cards: [],
        username: username
      });
    }
    game.gameState.playedWhiteCards.find((object) => {
      return object.username === username;
    }).cards.push(cardString);

    const playerIndex = getPlayerIndex(username);
    
    // Remove card from client hand.
    game.players[playerIndex].hand = game.players[playerIndex].hand.filter((value) => value !== cardString);
    game.log.push(`Player ${username} Played White Card: ${cardString}`);


    let playedCards = 0;

    for(const player of game.gameState.playedWhiteCards) {
      playedCards += player.cards.length;
    }
    game.gameState.czarReady = playedCards === (game.players.length - 1) * game.gameState.blackCard.pick;

    if(game.gameState.czarReady) {
      clearInterval(timeLeftInterval);
    }

    io.sockets.emit('updatedGame', game);
  });
  socket.on('czarPicked', (username) => {
    const playerIndex = getPlayerIndex(username);
    
    game.log.push(`Player ${username} won the round!`);
    
    // Increase the score by one.
    game.players[playerIndex].score++;
    game.gameState.czarHasPicked = true;

    // Check for winner.
    for(const player of game.players) {
      if(player.score === 10) {
        game.log.push(`Player ${player.username} won the game!`);
        io.sockets.emit('winner', player.username, game.players, game.log);
        console.log(`${player.username} won the game. Resetting.`);
        resetGame();
        return;
      }
    }

    // Deal more cards.
    for(const player of game.players) {
      if(player.hand.length < 10) {
        const cardsToAdd = 10 - player.hand.length;

        for(let cardsLeft = cardsToAdd; cardsLeft > 0; cardsLeft--) {
          // Check if the white card deck is empty.
          if(game.gameState.whiteCards.length === 0) {
            game.log.push('Refilling white cards.');
            addDecks(false, true);
          }

          // Add card.
          game.log.push(`Player ${player.username} Drew: ${game.gameState.whiteCards[0]}`);
          player.hand.push(game.gameState.whiteCards[0]);
          game.gameState.whiteCards.shift();
        }
      }
    }

    io.sockets.emit('roundWinner', username);
    io.sockets.emit('updatedGame', game);

    setTimeout(() => {
      if(game.gameState.czar === game.players.length - 1) {
        game.gameState.czar = 0;
      }else {
        game.gameState.czar++;
      }
      game.log.push(`New Czar: ${game.players[game.gameState.czar].username}.`);
      game.gameState.czarReady = false;
      game.gameState.czarHasPicked = false;
      game.gameState.playedWhiteCards = [];

      if(game.gameState.blackCards.length === 0) {
        game.log.push('Refilling black cards.');
        addDecks(true, false);
      }
      game.log.push(`Black Card in Play: ${game.gameState.blackCards[0].text}`);
      game.gameState.blackCard = game.gameState.blackCards[0];
      game.gameState.blackCards.shift();

      io.sockets.emit('updatedGame', game);
      io.sockets.emit('roundStart', game.timeoutTime);
      console.log('New round.');
    }, 3000);
  });
  socket.on('kill', () => {
    Object.values(io.sockets.connected).forEach((theSocket) => {
      theSocket.disconnect();
    });
    resetGame();
    console.log('Host killed the game.');
  });
  socket.on('disconnect', () => {
    if(socket) {
      removePlayer(socket.username);
    }
  });
});

app.get('/api/currentGame', (req, res) => {
  res.send(game);
});
app.get('/api/set/:set', (req, res) => {
  const set = req.params.set;

  if(fs.existsSync(`src/server/sets/${set}.json`)) {
    const contents = fs.readFileSync(`src/server/sets/${set}.json`);

    res.send(JSON.parse(contents));
    return;
  }
  res.send(`Set '${req.params.set}' does not exist.`);
});
app.get('/api/sets', (req, res) => {
  res.send(fs.readdirSync('src/server/sets/').map((set) => set.replace('.json', '')));
});
app.get('/api/randomWhiteCard/:set?', (req, res) => {
  const set = req.params.set || 'base-set';

  if(fs.existsSync(`src/server/sets/${set}.json`)) {
    const contents = fs.readFileSync(`src/server/sets/${set}.json`);
  
    res.send(randomOf(JSON.parse(contents).whiteCards));
    return;
  }
  res.send(`Set '${req.params.set}' does not exist.`);
});
app.get('/api/randomBlackCard/:set?', (req, res) => {
  const set = req.params.set || 'base-set';

  if(fs.existsSync(`src/server/sets/${set}.json`)) {
    const contents = fs.readFileSync(`src/server/sets/${set}.json`);

    res.send(randomOf(JSON.parse(contents).blackCards).text);
    return;
  }
  res.send(`Set '${req.params.set}' does not exist.`);
});
