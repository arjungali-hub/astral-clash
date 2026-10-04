// Spanish and French, keyed by the English text itself.
//
// WHY NO INVENTED KEYS. The usual shape is t('menu.start') with a table of
// identifiers, and it would mean touching all 134 markup strings to wrap each
// one. Keying on the ENGLISH SOURCE costs nothing at the call site, falls back
// to English for free when a translation is missing, and - the part that
// decides it - lets one DOM pass localise the whole of the markup without
// editing any of it.
//
// art/strings.py counted the job first: 260 strings, 2,263 words. That is what
// made this a day rather than a project, and the roadmap had been deferring it
// on a guess that it was the latter.
//
// TWO TIERS, because the two kinds of string need different granularity.
//
//   TEXT NODES   every label, button, heading and status line. Exact match on
//                the trimmed text node, so 'Start Match' is one entry.
//   WHOLE BLOCKS the tutorial's prose. Those paragraphs wrap phrases in <b>,
//                so their text nodes are FRAGMENTS - "keyboard to move", "(or
//                Up/Down) walk forward and back". Translating fragments gives
//                broken grammar in any language whose word order differs from
//                English, which is all of them. So a prose block is keyed by
//                its whole collapsed TEXT and translated as HTML, which leaves
//                the translation free to reorder and to put its own emphasis
//                wherever that language wants it.
//
// Character NAMES are not translated. Kaelen and Lyra are proper nouns; their
// TITLES ("Bastion Knight") are not, and are.
//
// Numbers, player names and room codes never pass through here: they arrive by
// interpolation, so they are not in any table and cannot be mangled by one.

const AC_LANGS = [
    { id: 'en', label: 'English' },
    { id: 'es', label: 'Español' },
    { id: 'fr', label: 'Français' },
];
const AC_LANG_KEY = 'astralClashLang';

// Entities are DECODED by the time text reaches a node: markup reading
// `Coins &amp; Unlocks` is the string `Coins & Unlocks` here. Keys are written
// decoded for that reason - an &amp; in a key would never match anything.
const I18N = {
    es: {
        // ---- the shell -------------------------------------------------
        'Astral Clash': 'Astral Clash',
        'Dimensional Arena Fighter': 'Luchador de arenas dimensionales',
        'Play Online': 'Jugar en línea',
        'Host Game': 'Crear partida',
        'Join Game': 'Unirse',
        'Leave Room': 'Salir de la sala',
        'Room code': 'Código de sala',
        'Enter a room code': 'Introduce un código de sala',
        'Your name': 'Tu nombre',
        'Not connected': 'Sin conexión',
        'Waiting...': 'Esperando...',
        'Choosing...': 'Eligiendo...',
        'Waiting for both fighters.': 'Esperando a los dos luchadores.',
        'Host’s choice': 'Decisión del anfitrión',
        'Match Setup': 'Configuración del combate',
        'Choose your fighter': 'Elige tu luchador',
        'Pick a fighter below': 'Elige un luchador abajo',
        'Start Match': 'Empezar combate',
        'Random (R)': 'Aleatorio (R)',
        'Random Arena': 'Arena aleatoria',
        'Arena: Random': 'Arena: aleatoria',
        'Choose Your Arena': 'Elige tu arena',
        'Game Mode': 'Modo de juego',
        'Game Modes': 'Modos de juego',
        'The Roster': 'Los luchadores',
        'Player Wins!': '¡Gana el jugador!',
        'Rematch (Same Arena)': 'Revancha (misma arena)',
        'Rematch (New Arena)': 'Revancha (arena nueva)',
        'Return to Menu': 'Volver al menú',
        'Resume (Esc)': 'Continuar (Esc)',
        'Back to Settings': 'Volver a ajustes',
        'Back to the Room': 'Volver a la sala',
        '← Back': '← Atrás',
        '← Back to the room': '← Volver a la sala',
        'Got it!': '¡Entendido!',
        'How to Play': 'Cómo jugar',
        'Rebind Keys': 'Reasignar teclas',
        'Audio Settings': 'Ajustes de audio',
        'Reset to Defaults': 'Restablecer',
        'Master volume': 'Volumen general',
        'Sound effects volume': 'Volumen de efectos',
        'Music volume': 'Volumen de música',
        'HUD Text': 'Texto del HUD',
        'Player Colours': 'Colores de jugador',
        'Switch to Local Version': 'Cambiar a versión local',
        'Sandbox: Off': 'Pruebas: no',
        'Sandbox — all unlocked, no coins':
            'Modo pruebas: todo desbloqueado, sin monedas',
        'Double Jump': 'Salto doble',
        'Coins & Unlocks': 'Monedas y desbloqueos',
        'Click to capture the mouse': 'Haz clic para capturar el ratón',
        'Waiting for the host to choose a rematch…':
            'Esperando a que el anfitrión elija la revancha…',
        'This version needs a computer': 'Esta versión necesita un ordenador',
        'Couldn’t load Three.js': 'No se pudo cargar Three.js',
        'Do not show How to Play automatically next time':
            'No mostrar «Cómo jugar» automáticamente la próxima vez',
        'Don’t show this automatically next time':
            'No mostrar esto automáticamente la próxima vez',
        'Your room code - share it with the other player':
            'Tu código de sala: compártelo con el otro jugador',
        'Switch the two player colours to a colourblind-safe pair':
            'Cambia los dos colores de jugador a un par seguro para daltonismo',
        'The arena, drawn from your fighter’s eyes. This game needs sight to play.':
            'La arena, vista por los ojos de tu luchador. Este juego requiere visión.',
        'Health, special meter and round score for both fighters.':
            'Salud, medidor especial y puntuación de ronda de ambos luchadores.',
        // ---- modes -----------------------------------------------------
        'Classic Versus': 'Versus clásico',
        'Zone Control': 'Control de zona',
        'Takedown Race': 'Carrera de derribos',
        'Boss Fight': 'Jefe',
        'Boss Fight (Co-op)': 'Jefe (cooperativo)',
        'Survival Waves': 'Oleadas de supervivencia',
        'Survival Waves (Co-op)': 'Oleadas de supervivencia (cooperativo)',
        'Mode: Classic Versus': 'Modo: Versus clásico',
        'Online Play': 'Juego en línea',
        'First-Person View': 'Vista en primera persona',
        'Movement & Jumping': 'Movimiento y salto',
        'Basic vs. Special': 'Básico y especial',
        'Arena Collapse': 'Derrumbe de la arena',
        'No Healing': 'Sin curación',
        'Looking for co-op?': '¿Buscas cooperativo?',
        'Controls': 'Controles',
        'Objective': 'Objetivo',
        'Dash': 'Desplazamiento',
        // ---- panels and notices ----------------------------------------
        'Two players on one keyboard, split screen. Shares your progress.':
            'Dos jugadores en un teclado, pantalla dividida. Comparte tu progreso.',
        'You are the host, so this is your call. Change it any time before you start the match — your opponent sees it update.':
            'Eres el anfitrión, así que la decisión es tuya. Cámbiala cuando quieras antes de empezar el combate: tu rival ve la actualización.',
        'Your own coins, unlocks and upgrades. Win a match to earn more.':
            'Tus propias monedas, desbloqueos y mejoras. Gana un combate para conseguir más.',
        'Click a key, then press its replacement. Esc cancels. Two actions cannot share a key — they swap.':
            'Haz clic en una tecla y pulsa su reemplazo. Esc cancela. Dos acciones no pueden compartir una tecla: se intercambian.',
        'One of you hosts and shares a room code; the other joins with it. Two players, one fighter each, on separate machines.':
            'Uno de los dos crea la partida y comparte un código de sala; el otro se une con él. Dos jugadores, un luchador cada uno, en máquinas distintas.',
        'One of you hosts and shares the room code; the other joins with it. The host plays as Player 1 and chooses the mode and arena. You will both land in the room as soon as the link is up.':
            'Uno de los dos crea la partida y comparte el código de sala; el otro se une con él. El anfitrión juega como Jugador 1 y elige el modo y la arena. Los dos entraréis en la sala en cuanto se establezca la conexión.',
        'The game engine failed to load from the CDN (cdn.jsdelivr.net). Check your internet connection, or an ad/script blocker may be blocking jsDelivr, then retry.':
            'El motor del juego no se pudo cargar desde la CDN (cdn.jsdelivr.net). Comprueba tu conexión a internet, o puede que un bloqueador de anuncios o de scripts esté bloqueando jsDelivr, y vuelve a intentarlo.',
        // ---- in-match text, drawn on the HUD ---------------------------
        'GET READY': 'PREPÁRATE',
        'FIGHT!': '¡LUCHA!',
        'CRUSHING!': '¡APLASTAMIENTO!',
        'SPECIAL READY': 'ESPECIAL LISTO',
        'Victory!': '¡Victoria!',
        'Draw!': '¡Empate!',
        'Zone contested': 'Zona disputada',
        'Resume Match': 'Continuar combate',
        'End match? Click again': '¿Terminar el combate? Haz clic otra vez',
        'Reset to defaults': 'Restablecer valores',
        'Nobody has joined yet': 'Todavía no se ha unido nadie',
        'No fighter yet': 'Aún sin luchador',
        'Unlock to buy upgrades': 'Desbloquéalo para comprar mejoras',
        'Bot: ON': 'Bot: sí',
        'Bot: OFF': 'Bot: no',
        'Sandbox on — everything unlocked, bot matches available':
            'Modo pruebas activado: todo desbloqueado, combates contra bots disponibles',
        'Your progression is back — two players only':
            'Tu progreso ha vuelto: solo dos jugadores',
        'If the last fighter standing falls, the run is over.':
            'Si cae el último luchador en pie, la partida termina.',
    },
    fr: {
        // ---- the shell -------------------------------------------------
        'Astral Clash': 'Astral Clash',
        'Dimensional Arena Fighter': 'Combats d’arène dimensionnels',
        'Play Online': 'Jouer en ligne',
        'Host Game': 'Héberger',
        'Join Game': 'Rejoindre',
        'Leave Room': 'Quitter le salon',
        'Room code': 'Code du salon',
        'Enter a room code': 'Entrez un code de salon',
        'Your name': 'Votre nom',
        'Not connected': 'Non connecté',
        'Waiting...': 'En attente...',
        'Choosing...': 'Choix en cours...',
        'Waiting for both fighters.': 'En attente des deux combattants.',
        'Host’s choice': 'Choix de l’hôte',
        'Match Setup': 'Préparation du combat',
        'Choose your fighter': 'Choisissez votre combattant',
        'Pick a fighter below': 'Choisissez un combattant ci-dessous',
        'Start Match': 'Lancer le combat',
        'Random (R)': 'Aléatoire (R)',
        'Random Arena': 'Arène aléatoire',
        'Arena: Random': 'Arène : aléatoire',
        'Choose Your Arena': 'Choisissez votre arène',
        'Game Mode': 'Mode de jeu',
        'Game Modes': 'Modes de jeu',
        'The Roster': 'Les combattants',
        'Player Wins!': 'Le joueur gagne !',
        'Rematch (Same Arena)': 'Revanche (même arène)',
        'Rematch (New Arena)': 'Revanche (nouvelle arène)',
        'Return to Menu': 'Retour au menu',
        'Resume (Esc)': 'Reprendre (Échap)',
        'Back to Settings': 'Retour aux réglages',
        'Back to the Room': 'Retour au salon',
        '← Back': '← Retour',
        '← Back to the room': '← Retour au salon',
        'Got it!': 'Compris !',
        'How to Play': 'Comment jouer',
        'Rebind Keys': 'Reconfigurer les touches',
        'Audio Settings': 'Réglages audio',
        'Reset to Defaults': 'Réinitialiser',
        'Master volume': 'Volume général',
        'Sound effects volume': 'Volume des effets',
        'Music volume': 'Volume de la musique',
        'HUD Text': 'Texte de l’interface',
        'Player Colours': 'Couleurs des joueurs',
        'Switch to Local Version': 'Passer à la version locale',
        'Sandbox: Off': 'Bac à sable : non',
        'Sandbox — all unlocked, no coins':
            'Bac à sable : tout débloqué, sans pièces',
        'Double Jump': 'Double saut',
        'Coins & Unlocks': 'Pièces et déblocages',
        'Click to capture the mouse': 'Cliquez pour capturer la souris',
        'Waiting for the host to choose a rematch…':
            'En attente du choix de revanche de l’hôte…',
        'This version needs a computer': 'Cette version nécessite un ordinateur',
        'Couldn’t load Three.js': 'Impossible de charger Three.js',
        'Do not show How to Play automatically next time':
            'Ne plus afficher « Comment jouer » automatiquement',
        'Don’t show this automatically next time':
            'Ne plus afficher ceci automatiquement',
        'Your room code - share it with the other player':
            'Votre code de salon : partagez-le avec l’autre joueur',
        'Switch the two player colours to a colourblind-safe pair':
            'Remplace les deux couleurs de joueur par une paire adaptée au daltonisme',
        'The arena, drawn from your fighter’s eyes. This game needs sight to play.':
            'L’arène, vue par les yeux de votre combattant. Ce jeu requiert la vue.',
        'Health, special meter and round score for both fighters.':
            'Santé, jauge spéciale et score de manche des deux combattants.',
        // ---- modes -----------------------------------------------------
        'Classic Versus': 'Versus classique',
        'Zone Control': 'Contrôle de zone',
        'Takedown Race': 'Course aux éliminations',
        'Boss Fight': 'Boss',
        'Boss Fight (Co-op)': 'Boss (coop)',
        'Survival Waves': 'Vagues de survie',
        'Survival Waves (Co-op)': 'Vagues de survie (coop)',
        'Mode: Classic Versus': 'Mode : Versus classique',
        'Online Play': 'Jeu en ligne',
        'First-Person View': 'Vue à la première personne',
        'Movement & Jumping': 'Déplacement et saut',
        'Basic vs. Special': 'Basique et spécial',
        'Arena Collapse': 'Effondrement de l’arène',
        'No Healing': 'Aucun soin',
        'Looking for co-op?': 'Envie de coopératif ?',
        'Controls': 'Commandes',
        'Objective': 'Objectif',
        'Dash': 'Ruée',
        // ---- panels and notices ----------------------------------------
        'Two players on one keyboard, split screen. Shares your progress.':
            'Deux joueurs sur un clavier, écran partagé. Partage votre progression.',
        'You are the host, so this is your call. Change it any time before you start the match — your opponent sees it update.':
            'Vous êtes l’hôte : c’est donc votre décision. Changez-la à tout moment avant de lancer le combat, votre adversaire voit la mise à jour.',
        'Your own coins, unlocks and upgrades. Win a match to earn more.':
            'Vos propres pièces, déblocages et améliorations. Gagnez un combat pour en obtenir plus.',
        'Click a key, then press its replacement. Esc cancels. Two actions cannot share a key — they swap.':
            'Cliquez sur une touche, puis appuyez sur celle qui la remplace. Échap annule. Deux actions ne peuvent pas partager une touche : elles s’échangent.',
        'One of you hosts and shares a room code; the other joins with it. Two players, one fighter each, on separate machines.':
            'L’un de vous héberge et partage un code de salon ; l’autre le rejoint avec. Deux joueurs, un combattant chacun, sur deux machines.',
        'One of you hosts and shares the room code; the other joins with it. The host plays as Player 1 and chooses the mode and arena. You will both land in the room as soon as the link is up.':
            'L’un de vous héberge et partage le code du salon ; l’autre le rejoint avec. L’hôte joue le Joueur 1 et choisit le mode et l’arène. Vous arriverez tous les deux dans le salon dès que la liaison est établie.',
        'The game engine failed to load from the CDN (cdn.jsdelivr.net). Check your internet connection, or an ad/script blocker may be blocking jsDelivr, then retry.':
            'Le moteur du jeu n’a pas pu être chargé depuis le CDN (cdn.jsdelivr.net). Vérifiez votre connexion internet, ou un bloqueur de publicités ou de scripts bloque peut-être jsDelivr, puis réessayez.',
        // ---- in-match text, drawn on the HUD ---------------------------
        'GET READY': 'PRÊT ?',
        'FIGHT!': 'COMBAT !',
        'CRUSHING!': 'ÉCRASEMENT !',
        'SPECIAL READY': 'SPÉCIALE PRÊTE',
        'Victory!': 'Victoire !',
        'Draw!': 'Égalité !',
        'Zone contested': 'Zone disputée',
        'Resume Match': 'Reprendre le combat',
        'End match? Click again': 'Terminer le combat ? Cliquez à nouveau',
        'Reset to defaults': 'Valeurs par défaut',
        'Nobody has joined yet': 'Personne ne s’est encore connecté',
        'No fighter yet': 'Pas encore de combattant',
        'Unlock to buy upgrades': 'Débloquez-le pour acheter des améliorations',
        'Bot: ON': 'Bot : oui',
        'Bot: OFF': 'Bot : non',
        'Sandbox on — everything unlocked, bot matches available':
            'Bac à sable activé : tout est débloqué, combats contre des bots disponibles',
        'Your progression is back — two players only':
            'Votre progression est de retour : deux joueurs uniquement',
        'If the last fighter standing falls, the run is over.':
            'Si le dernier combattant debout tombe, la partie est terminée.',
    },
};

// Prose blocks, keyed by their whole innerHTML. See the note at the top: a
// paragraph that wraps phrases in <b> has FRAGMENTS for text nodes, and no
// language keeps English's word order, so these are translated entire.
const I18N_HTML = {
    es: {
        "Astral Clash is played with a mouse to aim and a keyboard to move, so it needs a desktop or laptop. Open it there and you are set.":
            "Astral Clash se juega con un <b>ratón para apuntar</b> y un <b>teclado para moverse</b>, así que necesita un ordenador de sobremesa o portátil. Ábrelo ahí y listo.",

        "Best of 3 rounds. Win a round by knocking your opponent's HP to 0 — there's no clock to just run out, so see Arena Collapse below for how a round is guaranteed to end.":
            "Al mejor de 3 rondas. Ganas una ronda dejando los PV de tu rival a 0: no hay reloj que se agote, así que consulta «Derrumbe de la arena» más abajo para ver cómo se garantiza el final de una ronda.",

        "Every match is two people on two machines. One of you presses Play Online → Host Game and reads out the room code; the other pastes it into Join. You both land in the room, where you each pick your own fighter — you can only pick yours, and you'll see theirs appear as they choose.":
            "Cada combate es <b>dos personas en dos máquinas</b>. Uno de los dos pulsa <b>Jugar en línea → Crear partida</b> y lee en voz alta el código de sala; el otro lo pega en <b>Unirse</b>. Los dos entráis en la <b>sala</b>, donde cada uno elige su propio luchador: solo puedes elegir el tuyo, y verás aparecer el del otro a medida que elige.",

        "The host is Player 1 and owns the match settings: they choose the mode and the arena, and they press Start Match once you're both locked in. If your opponent drops mid-fight the match pauses and tells you.":
            "El <b>anfitrión es el Jugador 1</b> y controla los ajustes del combate: elige el modo y la arena, y pulsa <b>Empezar combate</b> cuando los dos estéis listos. Si tu rival se desconecta a mitad del combate, la partida se pausa y te avisa.",

        "You fight through your character's own eyes, weapon in hand. Move the mouse to look — click the arena once to capture the pointer, Esc releases it. Separate look up/down keys also aim vertically, and ranged attacks fire along that aim, so you can shoot up at someone on a high perch or down from one. You get the whole screen: your opponent is on their own machine.":
            "Luchas a través de los ojos de tu personaje, con el arma en la mano. <b>Mueve el ratón para mirar</b>: haz clic una vez en la arena para capturar el puntero, y Esc lo libera. Las teclas de <b>mirar arriba/abajo</b> también apuntan en vertical, y los ataques a distancia disparan siguiendo esa puntería, así que puedes disparar hacia arriba a alguien en una plataforma alta, o hacia abajo desde una. Tienes la <b>pantalla completa</b>: tu rival está en su propia máquina.",

        "No round timer — instead, a countdown to the next collapse. The whole arena closes in from all four sides on a timer (the edges literally crumble away), squeezing the fight toward the center so stalling isn't an option. If it fully shuts, both fighters are crushed and lose the same flat HP per second (regardless of max or current HP) until one dies — whoever's crushed first loses.":
            "No hay cronómetro de ronda; en su lugar, una cuenta atrás hasta el <em>siguiente derrumbe</em>. Toda la arena se cierra desde los cuatro lados con un temporizador (los bordes se desmoronan literalmente), apretando el combate hacia el centro para que hacer tiempo no sea una opción. Si se cierra por completo, los dos luchadores quedan aplastados y pierden los mismos PV fijos por segundo (independientemente de sus PV máximos o actuales) hasta que uno muere: pierde el primero en ser aplastado.",

        "W/S (or Up/Down) walk forward and back in whatever direction you're looking; A/D (or Left/Right) strafe sideways without turning. Aiming is the mouse's job, so the keys never rotate you. Jumping reaches platforms and cover but has a cooldown — you can't spam it. Small rises are walkable; tall ledges and walls aren't. Use columns and interior walls for cover. Buy Double Jump in the Armory to press jump again in mid-air, once per airborne stretch, for the tallest perches.":
            "<b>W/S</b> (o Arriba/Abajo) avanzan y retroceden en la dirección en la que estés mirando; <b>A/D</b> (o Izquierda/Derecha) hacen <b>desplazamiento lateral</b> sin girar. Apuntar es tarea del ratón, así que las teclas nunca te giran. Saltar alcanza plataformas y coberturas, pero tiene tiempo de recarga: no puedes abusar de él. Las subidas pequeñas se pueden caminar; los salientes altos y los muros, no. Usa las columnas y los muros interiores como cobertura. Compra el <b>Salto doble</b> en la Armería para volver a saltar en el aire, una vez por cada tramo aéreo, y llegar a las cornisas más altas.",

        "Basics are fast and always available; your Special needs a full meter, built by both dealing and taking damage. Each fighter's Special is unique — read it (and your opponent's) in the fighter panel.":
            "Los ataques básicos son rápidos y están siempre disponibles; tu Especial necesita el medidor lleno, que se llena tanto al causar daño como al recibirlo. El Especial de cada luchador es único: léelo (y el de tu rival) en el panel del luchador.",

        "Ten fighters, from twin-dagger rushdown to long-range casters. Reach and speed vary a lot — check a fighter's stats and Special in its detail panel before you commit.":
            "Diez luchadores, desde el acoso con dagas gemelas hasta los lanzadores de largo alcance. El alcance y la velocidad varían mucho: revisa las estadísticas y el Especial de un luchador en su panel de detalles antes de decidirte.",

        "A short burst with brief invulnerability frames — phases through attacks and projectiles entirely if timed right. Has its own cooldown, so it's a precise tool, not a shield.":
            "Una ráfaga corta con unos breves fotogramas de invulnerabilidad: atraviesa ataques y proyectiles por completo si la calculas bien. Tiene su propio tiempo de recarga, así que es una herramienta de precisión, no un escudo.",

        "There's no way to get HP back — no health pickups, no regen. Every hit you take counts. Play patient, punish mistakes, and use your dash i-frames and shields to avoid damage rather than trying to out-heal it.":
            "No hay forma de recuperar PV: no hay objetos de salud ni regeneración. Cada golpe que recibes cuenta. Juega con paciencia, castiga los errores y usa los fotogramas de invulnerabilidad del desplazamiento y los escudos para evitar el daño, en lugar de intentar curarte más rápido de lo que te golpean.",

        'The two co-op modes — Boss Fight against Karrigos the Granite Colossus, and Survival Waves against squads of lesser creatures — are playable online. The host simulates every enemy and sends the result, so both of you are always fighting the same boss in the same place rather than two copies that drift apart. If you go down you are out for 25 seconds and then respawn at full health; the run only ends if your teammate falls while you are still down.':
            "Los dos modos cooperativos — <b>Jefe</b> contra Karrigos, el Coloso de Granito, y <b>Oleadas de supervivencia</b> contra escuadrones de criaturas menores — son <b>jugables en línea</b>. El anfitrión simula todos los enemigos y envía el resultado, así que los dos lucháis siempre contra el mismo jefe en el mismo sitio, y no contra dos copias que se desincronizan. Si caes, quedas fuera <b>25 segundos</b> y luego reapareces con la salud completa; la partida solo termina si tu compañero cae mientras tú sigues en el suelo.",

        "The host picks the mode in the room, and you'll see their choice. Classic Versus is best of 3 rounds. Zone Control puts a glowing ring at the arena's centre — stand in it alone to bank control time, and knock your opponent out of it; first to 45 seconds wins. Takedown Race is one continuous fight with instant respawns, first to 3 takedowns — and the arena does not collapse in it, because a race cannot stall. In those last two a knockout costs you tempo, not the match.":
            "El <b>anfitrión</b> elige el modo en la sala, y verás su elección. <b>Versus clásico</b> es al mejor de 3 rondas. <b>Control de zona</b> coloca un anillo luminoso en el centro de la arena: quédate dentro <em>a solas</em> para acumular tiempo de control, y echa de él a tu rival; gana el primero que llegue a 45 segundos. <b>Carrera de derribos</b> es un combate continuo con reapariciones instantáneas, y gana el primero en lograr 3 derribos; la arena no se derrumba en este modo, porque una carrera no se puede alargar. En estos dos últimos, caer te cuesta ritmo, no el combate.",

        "Your coins, unlocks and upgrades are yours, saved on your own machine and the same whether you host or join. You start with three fighters; the rest are bought with coins earned from matches — the winner takes more, but a loss still pays something. Coins also buy permanent per-fighter upgrades to Health, Damage, Special charge rate and Speed, plus Double Jump. Open the Armory from the home screen or from the room while you're picking.":
            "<b>Tus monedas, desbloqueos y mejoras son tuyos</b>, guardados en tu propia máquina y los mismos tanto si creas la partida como si te unes. Empiezas con tres luchadores; el resto se compran con las monedas ganadas en los combates: el ganador se lleva más, pero una derrota también paga algo. Las monedas compran además mejoras permanentes por luchador de Salud, Daño, velocidad de carga del Especial y Velocidad, más el Salto doble. Abre la <b>Armería</b> desde la pantalla de inicio, o desde la sala mientras eliges.",
    },
    fr: {
        "Astral Clash is played with a mouse to aim and a keyboard to move, so it needs a desktop or laptop. Open it there and you are set.":
            "Astral Clash se joue avec une <b>souris pour viser</b> et un <b>clavier pour se déplacer</b> : il lui faut donc un ordinateur de bureau ou portable. Ouvrez-le là et c’est bon.",

        "Best of 3 rounds. Win a round by knocking your opponent's HP to 0 — there's no clock to just run out, so see Arena Collapse below for how a round is guaranteed to end.":
            "Au meilleur des 3 manches. Vous gagnez une manche en réduisant les PV de votre adversaire à 0 : aucun chronomètre ne vient l'interrompre, voyez donc « Effondrement de l'arène » plus bas pour savoir comment une manche finit forcément.",

        "Every match is two people on two machines. One of you presses Play Online → Host Game and reads out the room code; the other pastes it into Join. You both land in the room, where you each pick your own fighter — you can only pick yours, and you'll see theirs appear as they choose.":
            "Chaque combat se joue à <b>deux personnes sur deux machines</b>. L'un de vous appuie sur <b>Jouer en ligne → Héberger</b> et lit le code du salon à voix haute ; l'autre le colle dans <b>Rejoindre</b>. Vous arrivez tous les deux dans le <b>salon</b>, où chacun choisit son propre combattant : vous ne pouvez choisir que le vôtre, et vous verrez le sien apparaître au fur et à mesure.",

        "The host is Player 1 and owns the match settings: they choose the mode and the arena, and they press Start Match once you're both locked in. If your opponent drops mid-fight the match pauses and tells you.":
            "L'<b>hôte est le Joueur 1</b> et décide des réglages du combat : il choisit le mode et l'arène, et appuie sur <b>Lancer le combat</b> quand vous êtes tous les deux prêts. Si votre adversaire se déconnecte en pleine partie, le combat se met en pause et vous le signale.",

        "You fight through your character's own eyes, weapon in hand. Move the mouse to look — click the arena once to capture the pointer, Esc releases it. Separate look up/down keys also aim vertically, and ranged attacks fire along that aim, so you can shoot up at someone on a high perch or down from one. You get the whole screen: your opponent is on their own machine.":
            "Vous combattez par les yeux de votre personnage, arme en main. <b>Bougez la souris pour regarder</b> : cliquez une fois dans l'arène pour capturer le pointeur, Échap le relâche. Les touches <b>regarder haut/bas</b> visent aussi à la verticale, et les attaques à distance tirent le long de cette visée : vous pouvez donc tirer vers le haut sur quelqu'un perché, ou vers le bas depuis un perchoir. Vous avez l'<b>écran entier</b> : votre adversaire est sur sa propre machine.",

        "No round timer — instead, a countdown to the next collapse. The whole arena closes in from all four sides on a timer (the edges literally crumble away), squeezing the fight toward the center so stalling isn't an option. If it fully shuts, both fighters are crushed and lose the same flat HP per second (regardless of max or current HP) until one dies — whoever's crushed first loses.":
            "Pas de chronomètre de manche, mais un décompte jusqu'au <em>prochain effondrement</em>. L'arène entière se referme des quatre côtés sur une minuterie (les bords s'effritent littéralement), ce qui pousse le combat vers le centre : temporiser ne mène à rien. Si elle se referme complètement, les deux combattants sont écrasés et perdent le même nombre fixe de PV par seconde (quels que soient leurs PV maximum ou actuels) jusqu'à ce que l'un meure : le premier écrasé perd.",

        "W/S (or Up/Down) walk forward and back in whatever direction you're looking; A/D (or Left/Right) strafe sideways without turning. Aiming is the mouse's job, so the keys never rotate you. Jumping reaches platforms and cover but has a cooldown — you can't spam it. Small rises are walkable; tall ledges and walls aren't. Use columns and interior walls for cover. Buy Double Jump in the Armory to press jump again in mid-air, once per airborne stretch, for the tallest perches.":
            "<b>W/S</b> (ou Haut/Bas) avancent et reculent dans la direction où vous regardez ; <b>A/D</b> (ou Gauche/Droite) font un <b>pas de côté</b> sans vous tourner. Viser est le rôle de la souris, les touches ne vous font donc jamais pivoter. Le saut atteint les plateformes et les couverts, mais a un temps de recharge : impossible de l'enchaîner. Les petites marches se franchissent à pied, les rebords hauts et les murs non. Servez-vous des colonnes et des murs intérieurs comme couvert. Achetez le <b>Double saut</b> à l'Armurerie pour sauter une seconde fois en plein air, une fois par envol, et atteindre les perchoirs les plus hauts.",

        "Basics are fast and always available; your Special needs a full meter, built by both dealing and taking damage. Each fighter's Special is unique — read it (and your opponent's) in the fighter panel.":
            "Les attaques de base sont rapides et toujours disponibles ; votre Spéciale exige une jauge pleine, qui se remplit autant en infligeant qu'en subissant des dégâts. La Spéciale de chaque combattant est unique : lisez-la (et celle de votre adversaire) dans le panneau du combattant.",

        "Ten fighters, from twin-dagger rushdown to long-range casters. Reach and speed vary a lot — check a fighter's stats and Special in its detail panel before you commit.":
            "Dix combattants, de l'assaut à deux dagues aux lanceurs de sorts à longue portée. La portée et la vitesse varient beaucoup : consultez les statistiques et la Spéciale d'un combattant dans son panneau de détails avant de vous engager.",

        "A short burst with brief invulnerability frames — phases through attacks and projectiles entirely if timed right. Has its own cooldown, so it's a precise tool, not a shield.":
            "Une ruée brève avec quelques images d'invulnérabilité : elle traverse entièrement attaques et projectiles si le timing est bon. Elle a son propre temps de recharge : c'est un outil de précision, pas un bouclier.",

        "There's no way to get HP back — no health pickups, no regen. Every hit you take counts. Play patient, punish mistakes, and use your dash i-frames and shields to avoid damage rather than trying to out-heal it.":
            "Aucun moyen de récupérer des PV : ni soins à ramasser, ni régénération. Chaque coup reçu compte. Jouez patiemment, punissez les erreurs, et servez-vous des images d'invulnérabilité de la ruée et des boucliers pour éviter les dégâts plutôt que d'essayer de les soigner.",

        'The two co-op modes — Boss Fight against Karrigos the Granite Colossus, and Survival Waves against squads of lesser creatures — are playable online. The host simulates every enemy and sends the result, so both of you are always fighting the same boss in the same place rather than two copies that drift apart. If you go down you are out for 25 seconds and then respawn at full health; the run only ends if your teammate falls while you are still down.':
            "Les deux modes coopératifs — <b>Boss</b> contre Karrigos, le Colosse de Granit, et <b>Vagues de survie</b> contre des escouades de créatures mineures — sont <b>jouables en ligne</b>. L'hôte simule tous les ennemis et envoie le résultat : vous affrontez donc toujours le même boss au même endroit, et non deux copies qui divergent. Si vous tombez, vous êtes hors jeu pendant <b>25 secondes</b> puis réapparaissez en pleine santé ; la partie ne se termine que si votre équipier tombe pendant que vous êtes encore au sol.",

        "The host picks the mode in the room, and you'll see their choice. Classic Versus is best of 3 rounds. Zone Control puts a glowing ring at the arena's centre — stand in it alone to bank control time, and knock your opponent out of it; first to 45 seconds wins. Takedown Race is one continuous fight with instant respawns, first to 3 takedowns — and the arena does not collapse in it, because a race cannot stall. In those last two a knockout costs you tempo, not the match.":
            "L'<b>hôte</b> choisit le mode dans le salon, et vous verrez son choix. <b>Versus classique</b> se joue au meilleur des 3 manches. <b>Contrôle de zone</b> place un anneau lumineux au centre de l'arène : tenez-vous-y <em>seul</em> pour accumuler du temps de contrôle, et délogez-en votre adversaire ; le premier à 45 secondes gagne. <b>Course aux éliminations</b> est un combat continu avec réapparition immédiate, le premier à 3 éliminations gagne — et l'arène ne s'y effondre pas, parce qu'une course ne peut pas s'enliser. Dans ces deux derniers modes, se faire sortir coûte du tempo, pas le combat.",

        "Your coins, unlocks and upgrades are yours, saved on your own machine and the same whether you host or join. You start with three fighters; the rest are bought with coins earned from matches — the winner takes more, but a loss still pays something. Coins also buy permanent per-fighter upgrades to Health, Damage, Special charge rate and Speed, plus Double Jump. Open the Armory from the home screen or from the room while you're picking.":
            "<b>Vos pièces, déblocages et améliorations sont à vous</b>, enregistrés sur votre propre machine et identiques que vous hébergiez ou rejoigniez. Vous commencez avec trois combattants ; les autres s'achètent avec les pièces gagnées en combat : le vainqueur en prend plus, mais une défaite rapporte quand même quelque chose. Les pièces achètent aussi des améliorations permanentes par combattant pour la Santé, les Dégâts, la vitesse de charge de la Spéciale et la Vitesse, ainsi que le Double saut. Ouvrez l'<b>Armurerie</b> depuis l'écran d'accueil ou depuis le salon pendant que vous choisissez.",
    },
};

// Read on FIRST USE, not at load. Each shared module is its own top-level
// script, so the only thing that orders them is the tag order in index.html -
// and safeLSGet lives in common.js, which loads after this. A load-time read
// here would be a ReferenceError that depended on a list in sync_local.py,
// which is a dependency worth not having.
let acLang = null;

function curLang() {
    if (acLang === null) {
        const saved = safeLSGet(AC_LANG_KEY);
        acLang = AC_LANGS.some(l => l.id === saved) ? saved : 'en';
    }
    return acLang;
}

// The translation, or the English back. A missing entry is a visible gap in one
// language rather than a crash or a blank, which is the right failure for this.
function t(s) {
    const lang = curLang();
    if (lang === 'en' || !s) return s;
    const table = I18N[lang];
    if (!table) return s;
    const key = String(s).trim();
    const hit = table[key];
    if (hit === undefined) return s;
    // Leading and trailing space is layout, not content: a fragment like
    // ' and a ' must keep its edges or words run together.
    const lead = /^\s*/.exec(s)[0], tail = /\s*$/.exec(s)[0];
    return lead + hit + tail;
}

// One spelling for a block of prose: no leading or trailing space, and every
// run of whitespace - including the newlines the source file is indented with -
// collapsed to a single space.
function proseKey(text) { return String(text || '').split(/\s+/).join(' ').trim(); }

const I18N_ATTRS = ['placeholder', 'title', 'aria-label'];

// ONE PASS over the markup, which is what keying on English buys. It is
// idempotent by construction: a translated node no longer matches an English
// key, so running it twice changes nothing and a freshly rendered panel is
// picked up on the next call.
function localiseDOM(root) {
    const lang = curLang();
    if (lang === 'en') return;
    const scope = root || document.body;
    if (!scope) return;
    const htmlTable = I18N_HTML[lang] || {};

    // Prose blocks first: they own their children, so translating their text
    // nodes individually afterwards would be working against them.
    //
    // Keyed on TEXT, not on innerHTML. innerHTML is re-serialised by the
    // browser and only half-predictably: `&mdash;` in the source comes back as
    // a literal em dash while `&amp;` comes back still encoded. A key written
    // against the source file would miss on a rule nobody could see. Collapsed
    // textContent has exactly one spelling. The VALUE is still HTML, so a
    // translation keeps its own <b> emphasis wherever that language wants it.
    for (const el of scope.querySelectorAll('p, li, .tutorial-controls-row')) {
        const hit = htmlTable[proseKey(el.textContent)];
        if (hit !== undefined) el.innerHTML = hit;
    }

    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const p = node.parentElement;
            if (!p) return NodeFilter.FILTER_REJECT;
            // Never rewrite script, style, or a field somebody is typing in.
            const tag = p.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') {
                return NodeFilter.FILTER_REJECT;
            }
            return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT
                                         : NodeFilter.FILTER_REJECT;
        },
    });
    const table = I18N[lang] || {};
    const pending = [];
    let n;
    while ((n = walker.nextNode())) {
        const key = n.nodeValue.trim();
        if (table[key] !== undefined) pending.push(n);
    }
    // Collected first, then written: mutating during a TreeWalker's traversal
    // is asking for a skipped node.
    for (const node of pending) node.nodeValue = t(node.nodeValue);

    for (const el of scope.querySelectorAll('[placeholder], [title], [aria-label]')) {
        for (const a of I18N_ATTRS) {
            const v = el.getAttribute(a);
            if (v && table[v.trim()] !== undefined) el.setAttribute(a, t(v));
        }
    }
}

function setLang(id) {
    acLang = AC_LANGS.some(l => l.id === id) ? id : 'en';
    safeLSSet(AC_LANG_KEY, acLang);
    refreshLangUI();
    // English cannot be restored by re-walking - the English keys are gone from
    // the DOM once translated - so switching back reloads. Switching BETWEEN
    // two translations has the same problem, so every change reloads: one
    // predictable rule rather than a special case that works three times out of
    // four. The choice is in localStorage by then, so it survives the reload.
    location.reload();
}

function cycleLang() {
    const at = AC_LANGS.findIndex(l => l.id === curLang());
    setLang(AC_LANGS[(at + 1) % AC_LANGS.length].id);
}

function langLabel() {
    const l = AC_LANGS.find(x => x.id === curLang());
    return l ? l.label : 'English';
}

function refreshLangUI() {
    setOptState('btn-lang', langLabel(), curLang() !== 'en');
}

// How much of each language is actually written, for the checker and for
// anyone wondering whether a gap is a bug or just unfinished.
function langCoverage(id) {
    const table = I18N[id] || {};
    const html = I18N_HTML[id] || {};
    return { strings: Object.keys(table).length, blocks: Object.keys(html).length };
}

// ONE call site for the whole of the markup, from the frame loop.
//
// Every alternative was worse. Calling localiseDOM from each panel's render
// function means finding all of them and remembering the next one - the exact
// failure that left syncTouchUI() defined and never called for several batches.
// Calling it once at startup misses every panel built later, which is most of
// them: the roster grid, the shop, the results screen, the rebind list.
//
// Throttled, and never during a live fight: a tree walk over the menu DOM is
// cheap but not free, and nothing in the markup changes while two people are
// swinging at each other - the HUD is canvas, not DOM.
const LOCALISE_MS = 400;
let lastLocalise = 0;

function localiseTick() {
    if (curLang() === 'en') return;
    if (inLiveMatch()) return;
    const now = performance.now();
    if (now - lastLocalise < LOCALISE_MS) return;
    lastLocalise = now;
    localiseDOM();
}
