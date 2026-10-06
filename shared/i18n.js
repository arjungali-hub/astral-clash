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
        'Play': 'Jugar',
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
        "Host's choice": 'Decisión del anfitrión',
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
        'Player Colors': 'Colores de jugador',
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
        "Couldn't load Three.js": 'No se pudo cargar Three.js',
        'Do not show How to Play automatically next time':
            'No mostrar «Cómo jugar» automáticamente la próxima vez',
        "Don't show this automatically next time":
            'No mostrar esto automáticamente la próxima vez',
        'Your room code - share it with the other player':
            'Tu código de sala: compártelo con el otro jugador',
        'Switch the two player colors to a colorblind-safe pair':
            'Cambia los dos colores de jugador a un par seguro para daltonismo',
        "The arena, drawn from your fighter's eyes. This game needs sight to play.":
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

        // ---- the last of them ------------------------------------------
        "; if you want to fight a bot or try the whole roster, turn on the \"Unlock everything\" sandbox in Settings — it leaves both players' real progress untouched and earns no coins.":
            "; si quieres luchar contra un bot o probar todo el elenco, activa el modo de pruebas «Desbloquear todo» en Ajustes: deja intacto el progreso real de ambos jugadores y no da monedas.",
        "Astral Clash is a first-person game, and a portrait screen puts both of your thumbs in the middle of the view.":
            "Astral Clash es un juego en primera persona, y una pantalla vertical te deja los dos pulgares en medio de la vista.",
        "Difficulty: ‹ Normal ›":
            "Dificultad: ‹ Normal ›",
        "Keep your coins and unlocks on every device":
            "Conserva tus monedas y desbloqueos en todos tus dispositivos",
        "Language of menus and help text":
            "Idioma de los menús y de la ayuda",
        "Left thumb moves · drag to aim · tap to fire":
            "Pulgar izquierdo para moverte · arrastra para apuntar · toca para disparar",
        "Play Online":
            "Jugar en línea",
        "Rotate to landscape":
            "Gíralo en horizontal",
        "Send which fighter won, with nothing about you":
            "Envía qué luchador ganó, sin nada sobre ti",
        "Share Stats":
            "Compartir datos",
        "Special attack":
            "Ataque especial",
        "Turn your phone sideways":
            "Gira el teléfono",
        "Your coins, unlocks and upgrades live on your account, not on this machine — sign in on any device and they are there.":
            "Tus monedas, desbloqueos y mejoras viven en tu cuenta, no en esta máquina: inicia sesión en cualquier dispositivo y ahí estarán.",
        "Your opponent sees your choice in the room. Nothing starts until you press":
            "Tu rival ve tu elección en la sala. No empieza nada hasta que pulses",
        // ---- the split-screen build -------------------------------------
        "(keys on cards)":
            "(teclas en las tarjetas)",
        "Bot Fighter":
            "Luchador bot",
        "Choose your fighters":
            "Elegid vuestros luchadores",
        "Co-op: Boss & Survival":
            "Cooperativo: Jefe y Supervivencia",
        "Pick a battleground, or drop into a random one.":
            "Elige un campo de batalla, o entra en uno al azar.",
        "Play Again":
            "Jugar otra vez",
        "Player 1 name":
            "Nombre del Jugador 1",
        "Player 1 — Armory":
            "Jugador 1 — Armería",
        "Player 2 name":
            "Nombre del Jugador 2",
        "Player 2 — Armory":
            "Jugador 2 — Armería",
        "Random (/)":
            "Aleatorio (/)",
        "Randomly chosen when the match starts":
            "Elegida al azar cuando empieza el combate",
        "The longest melee reach in the game, but through a narrow cone — it is a line, not a sweep, so it needs to be aimed rather than swung in someone's general direction.":
            "El mayor alcance cuerpo a cuerpo del juego, pero en un cono estrecho: es una línea, no un barrido, así que hay que apuntarlo en lugar de agitarlo en la dirección general del rival.",
        "Time Attack":
            "Carrera de derribos",
        "Titan's Wrath":
            "Ira del Titán",
        "What are you playing for? You can change this any time before the match starts.":
            "¿Por qué jugáis? Puedes cambiarlo en cualquier momento antes de que empiece el combate.",
        "← Back to Fighters":
            "← Volver a los luchadores",
        // ---- challenges, modes, and the rest of both builds -------------
        "Account":
            "Cuenta",
        "Armory":
            "Armería",
        "Back":
            "Atrás",
        "Back to Online Version":
            "Volver a la versión en línea",
        "Best of 3 rounds. Knock your opponent out to win a round.":
            "Al mejor de 3 rondas. Deja fuera de combate a tu rival para ganar una ronda.",
        "Both players team up against Karrigos, the Granite Colossus. Its attacks are slow and telegraphed — punish the wind-up. Go down and you are out for 25 seconds; if your teammate falls while you are down, the run is over.":
            "Los dos jugadores se unen contra Karrigos, el Coloso de Granito. Sus ataques son lentos y telegrafiados: castiga la preparación. Si caes, quedas fuera 25 segundos; si tu compañero cae mientras tú estás en el suelo, la partida termina.",
        "Clear a Survival Waves run with a teammate":
            "Completa una partida de Oleadas de supervivencia con un compañero",
        "Clears both players' coins, unlocks and upgrades on this machine. Names are kept. Click twice to confirm.":
            "Borra las monedas, los desbloqueos y las mejoras de ambos jugadores en esta máquina. Los nombres se conservan. Haz clic dos veces para confirmar.",
        "Coins":
            "Monedas",
        "Confirm":
            "Confirmar",
        "Continuous fight with instant respawns. First to 3 takedowns wins. No arena collapse — the race is the pressure.":
            "Combate continuo con reapariciones instantáneas. Gana el primero en lograr 3 derribos. Sin derrumbe de la arena: la carrera es la presión.",
        "Controls":
            "Controles",
        "Copy":
            "Copiar",
        "Create account":
            "Crear cuenta",
        "Damage":
            "Daño",
        "Dash":
            "Desplazamiento",
        "Deal 400 damage in a single match":
            "Inflige 400 de daño en un solo combate",
        "Details":
            "Detalles",
        "Display name":
            "Nombre visible",
        "Email":
            "Correo electrónico",
        "Forgotten your password?":
            "¿Olvidaste tu contraseña?",
        "Glow":
            "Brillo",
        "Health":
            "Salud",
        "Hold the glowing ring at the center. First to 45 seconds of control wins — knock them out of it.":
            "Mantente en el anillo luminoso del centro. Gana el primero en acumular 45 segundos de control: échalo de ahí.",
        "Join":
            "Unirse",
        "Land a single hit for 60 damage or more":
            "Acierta un solo golpe de 60 de daño o más",
        "Language":
            "Idioma",
        "Main Attack":
            "Ataque principal",
        "Mute":
            "Silenciar",
        "New password":
            "Nueva contraseña",
        "Objective":
            "Objetivo",
        "Password":
            "Contraseña",
        "Player 1":
            "Jugador 1",
        "Player 2":
            "Jugador 2",
        "Quit to Menu":
            "Salir al menú",
        "Rematch":
            "Revancha",
        "Reset Progress":
            "Reiniciar progreso",
        "Resume":
            "Continuar",
        "Retry":
            "Reintentar",
        "Save new password":
            "Guardar la nueva contraseña",
        "Send reset link":
            "Enviar enlace de restablecimiento",
        "Settings":
            "Ajustes",
        "Shield":
            "Escudo",
        "Shop":
            "Tienda",
        "Sign in":
            "Iniciar sesión",
        "Sign out":
            "Cerrar sesión",
        "Sound":
            "Sonido",
        "Special":
            "Especial",
        "Speed":
            "Velocidad",
        "Team up and hold out against an endless run of ever-tougher challengers, one at a time. Coins for every wave cleared.":
            "Haced equipo y resistid contra una sucesión interminable de rivales cada vez más duros, de uno en uno. Monedas por cada oleada superada.",
        "Today’s Challenges":
            "Desafíos de hoy",
        "Try every fighter and maxed-out upgrades without spending coins, and play against a bot. Each player's real progress is kept separately and comes back exactly as it was when you turn this off. Nothing you do in here earns coins — progression matches are two players, one keyboard.":
            "Prueba a todos los luchadores y las mejoras al máximo sin gastar monedas, y juega contra un bot. El progreso real de cada jugador se guarda aparte y vuelve exactamente como estaba cuando desactives esto. Nada de lo que hagas aquí da monedas: los combates de progresión son de dos jugadores en un teclado.",
        "Unlock everything (sandbox)":
            "Desbloquear todo (pruebas)",
        "Use your Special three times in one match":
            "Usa tu Especial tres veces en un combate",
        "Username":
            "Nombre de usuario",
        "Win a Classic match 2-0":
            "Gana un combate Clásico por 2-0",
        "Win a Takedown Race":
            "Gana una Carrera de derribos",
        "Win a Zone Control match":
            "Gana un combate de Control de zona",
        "Win a match after losing the first round":
            "Gana un combate tras perder la primera ronda",
        "Win a match without using your Special":
            "Gana un combate sin usar tu Especial",
        "Win a round in under 20 seconds":
            "Gana una ronda en menos de 20 segundos",
        "← Back to signing in":
            "← Volver a iniciar sesión",
        // ---- the roster ------------------------------------------------
        "A balanced duelist with no bad matchup and no free win either. He wants to live at the edge of his own reach, trading slashes and using the dash to cross the gap or escape a corner.":
            "Un duelista equilibrado sin ningún emparejamiento malo y sin ninguna victoria regalada. Quiere vivir en el borde de su propio alcance, intercambiando tajos y usando el desplazamiento para cruzar la distancia o escapar de una esquina.",
        "A blazing-fast glass cannon with the thinnest health of any melee fighter. He wins by never being where the last swing was — and the flurry is invulnerable, so it doubles as a way to run straight through an incoming attack.":
            "Un cañón de cristal vertiginoso, con la salud más frágil de cualquier luchador cuerpo a cuerpo. Gana no estando nunca donde cayó el último golpe, y la ráfaga es invulnerable, así que también sirve para atravesar de lleno un ataque entrante.",
        "A ground slam that launches the enemy away and stuns them.":
            "Un impacto contra el suelo que lanza al enemigo por los aires y lo aturde.",
        "A heavy hammer swing through a narrow cone. Slow to start and slow to recover, so a whiff is a real punish — but it hits hard enough to be worth the risk.":
            "Un mazazo pesado en un cono estrecho. Lento de iniciar y lento de recuperar, así que fallar es un castigo real, pero golpea lo bastante fuerte como para merecer el riesgo.",
        "A long scythe sweep through a wide cone — more reach than any other melee basic except Thorne, and wide enough that a sidestep alone will not clear it.":
            "Un barrido largo de guadaña en un cono amplio: más alcance que cualquier otro básico cuerpo a cuerpo salvo el de Thorne, y lo bastante ancho como para que un paso lateral por sí solo no baste.",
        "A mountain that learned to move. Slow, enormous, and utterly unbothered.":
            "Una montaña que aprendió a moverse. Lento, enorme y absolutamente impasible.",
        "A quick sword arc through a wide cone in front of him. Short reach, but it recovers fast enough to throw out on reaction and keep throwing.":
            "Un arco de espada rápido en un cono amplio frente a él. Poco alcance, pero se recupera lo bastante rápido como para soltarlo por reacción y seguir soltándolo.",
        "A ranged stormcaller who outranges everyone. Her special is the exception to everything else she does: it lands on the target directly rather than travelling, so it cannot be dodged or blocked by cover.":
            "Una invocadora de tormentas a distancia que supera el alcance de todos. Su especial es la excepción a todo lo demás que hace: cae directamente sobre el objetivo en lugar de viajar, así que no se puede esquivar ni bloquear con cobertura.",
        "A rapid flurry jab with a very short cooldown. The least damage per hit on the roster, but you land far more of them than anyone else does.":
            "Un golpe de ráfaga rápido con un tiempo de recarga muy corto. El menor daño por impacto del elenco, pero aciertas muchísimos más que nadie.",
        "A relentless pressure fighter, fast on his feet and faster with his fists. The burst itself is modest — the burn afterwards is the real payload, and it keeps ticking while you keep jabbing.":
            "Un luchador de presión implacable, rápido de pies y más rápido de puños. El estallido en sí es modesto: la quemadura posterior es la carga real, y sigue consumiendo mientras tú sigues golpeando.",
        "A short shockwave that shoves you off.":
            "Una onda expansiva corta que te aparta de un empujón.",
        "A short-range overhead smash that hard-stuns (knocks down).":
            "Un mazazo descendente de corto alcance que aturde con fuerza (derriba).",
        "A space-controller with the longest melee reach on the roster. He fights from a distance most characters consider safe, and the root buys him more than a second of free hits from exactly there.":
            "Un controlador de espacio con el mayor alcance cuerpo a cuerpo del elenco. Pelea desde una distancia que casi todos consideran segura, y el enraizamiento le compra más de un segundo de golpes gratis justo desde ahí.",
        "A wide thorn-arc that ensnares (roots) the enemy in place.":
            "Un arco amplio de espinas que atrapa (enraíza) al enemigo en el sitio.",
        "Antlered Reaver":
            "Saqueador Astado",
        "Armoured but not immovable, and he builds special meter far faster than anyone else — so the knockdown comes around often. Use it to reset a fight you are losing, not just for the damage.":
            "Acorazado pero no inamovible, y carga el medidor especial mucho más rápido que nadie, así que el derribo vuelve a menudo. Úsalo para reiniciar un combate que vas perdiendo, no solo por el daño.",
        "Ashen Mortar":
            "Mortero Ceniciento",
        "Astral Orb":
            "Orbe Astral",
        "Astral Ward":
            "Égida Astral",
        "Bastion Knight":
            "Caballero Bastión",
        "Blade Dash":
            "Embate de Filo",
        "Blink onto the enemy and stab rapidly, briefly invulnerable.":
            "Parpadea hasta el enemigo y apuñala rápidamente, brevemente invulnerable.",
        "Bramble Lash":
            "Azote de Zarzas",
        "Call a bolt down directly onto the enemy — cannot be sidestepped.":
            "Invoca un rayo directamente sobre el enemigo: no se puede esquivar de lado.",
        "Cinder Pugilist":
            "Púgil de Brasa",
        "Cinder Spray":
            "Rociada de Brasas",
        "Cowled Harvester":
            "Segador Encapuchado",
        "Cycles between a shockwave Ground Slam, a telegraphed Charge, and an Ember Nova spread.":
            "Alterna entre un Rompesuelos de onda expansiva, una Carga telegrafiada y una dispersión de Nova de Brasas.",
        "Darts through its target.":
            "Se lanza a través de su objetivo.",
        "Dash through the enemy, cutting them on the pass and ending behind them.":
            "Atraviesa al enemigo de un embate, cortándolo al pasar y acabando detrás de él.",
        "Ember Jab":
            "Golpe de Ascua",
        "Erupt in flame, leaving the enemy burning over time.":
            "Estalla en llamas, dejando al enemigo ardiendo con el tiempo.",
        "Fires a single fast shard in a straight line. Long range, but it is a real projectile — it can miss, and it can be sidestepped or blocked by cover.":
            "Dispara una sola esquirla rápida en línea recta. Largo alcance, pero es un proyectil de verdad: puede fallar, y se puede esquivar de lado o bloquear con cobertura.",
        "Flicker Cutthroat":
            "Degollador Fugaz",
        "Forge Hammerfist":
            "Puño de Forja",
        "Fragile and deadly at range. She loses any melee exchange she is dragged into, so the whole game is keeping the gap open — the volley is as much a wall as it is damage.":
            "Frágil y letal a distancia. Pierde cualquier intercambio cuerpo a cuerpo al que la arrastren, así que todo el juego consiste en mantener la distancia abierta: la andanada es tanto un muro como daño.",
        "Gaunt Wraith":
            "Espectro Enjuto",
        "Glass Shard":
            "Esquirla de Vidrio",
        "Granite Colossus":
            "Coloso de Granito",
        "Ground Breaker":
            "Rompesuelos",
        "Haloed Aegis":
            "Égida Nimbada",
        "Hangs back and lobs fire. Punish it for existing.":
            "Se queda atrás y lanza fuego. Castígalo por existir.",
        "Inferno Burst":
            "Estallido Infernal",
        "Ironclad Smash":
            "Mazazo Acorazado",
        "Lobs a slow-building orb of light down a long, narrow line. Low damage per shot — it is chip damage meant to be applied constantly from a safe distance.":
            "Lanza un orbe de luz de carga lenta por una línea larga y estrecha. Poco daño por disparo: es daño de desgaste pensado para aplicarse sin parar desde una distancia segura.",
        "Long reach that drags foes into the blade. The special pulls a runaway opponent from well outside her range and roots them there, which turns a fleeing ranged fighter into a free follow-up.":
            "Gran alcance que arrastra a los enemigos hacia la hoja. El especial atrae a un rival que huye desde muy fuera de su alcance y lo enraíza allí, lo que convierte a un luchador a distancia en fuga en un seguimiento gratuito.",
        "Prism Volley":
            "Andanada Prismática",
        "Quickstab":
            "Puntazo Veloz",
        "Raise a strong shield that halves incoming damage for several seconds.":
            "Alza un escudo potente que reduce a la mitad el daño recibido durante varios segundos.",
        "Rhythm Slash":
            "Tajo Rítmico",
        "Scrap Gremlin":
            "Gremlin Chatarrero",
        "Seismic Slam":
            "Impacto Sísmico",
        "Shadow Flurry":
            "Ráfaga de Sombras",
        "Shardwing Sylph":
            "Sílfide Alaesquirla",
        "Skitter":
            "Correteo",
        "Slow, heavy, and unbothered by your first few hits.":
            "Lento, pesado e indiferente a tus primeros golpes.",
        "Spits a fan of molten shards.":
            "Escupe un abanico de esquirlas fundidas.",
        "Spray a wide 5-shard fan to wall off space.":
            "Rocía un abanico amplio de 5 esquirlas para cerrar el espacio.",
        "Storm Bolt":
            "Rayo de Tormenta",
        "Stormcrown Valkyrie":
            "Valquiria Coronatormenta",
        "Tectonic Brute":
            "Bruto Tectónico",
        "Tempo Duelist":
            "Duelista de Tempo",
        "The fastest basic in the game — a near-instant dagger poke with almost no recovery. The reach is the shortest in the game, so you have to be genuinely on top of someone.":
            "El básico más rápido del juego: un pinchazo de daga casi instantáneo y sin apenas recuperación. El alcance es el más corto del juego, así que tienes que estar realmente encima del rival.",
        "The hardest-hitting basic on the roster, and by far the most committal — a long wind-up and a long recovery. Two of these end most fights; two whiffs end yours.":
            "El básico más contundente del elenco, y con diferencia el más comprometido: una preparación larga y una recuperación larga. Dos de estos acaban con casi cualquier combate; dos fallos acaban con el tuyo.",
        "The largest health pool in the game, on the slowest fighter in it. He cannot chase anyone, so he wins by making the space directly in front of him unaffordable to stand in — and the slam clears that space again whenever someone gets comfortable.":
            "La mayor reserva de salud del juego, en el luchador más lento que hay. No puede perseguir a nadie, así que gana haciendo que el espacio justo delante de él sea insostenible, y el impacto despeja ese espacio cada vez que alguien se acomoda.",
        "The longest melee reach in the game, but through a narrow cone — it is a line, not a sweep, so it needs to be aimed rather than swung in someone's general direction.":
            "El mayor alcance cuerpo a cuerpo del juego, pero en un cono estrecho: es una línea, no un barrido, así que hay que apuntarlo en lugar de agitarlo en la dirección general del rival.",
        "The longest-range basic in the game: a fast bolt down a very tight line. It demands real aim — the cone is the narrowest on the roster and it is still a dodgeable projectile.":
            "El básico de mayor alcance del juego: un rayo rápido por una línea muy estrecha. Exige puntería de verdad: el cono es el más angosto del elenco y sigue siendo un proyectil esquivable.",
        "The only fighter whose special deals no damage at all. She survives instead of trading: the ward halves everything for over three seconds, which is long enough to walk through a special that would have killed her. Her meter builds slowest, so spend it deliberately.":
            "La única luchadora cuyo especial no hace ningún daño. Sobrevive en lugar de intercambiar: la égida reduce todo a la mitad durante más de tres segundos, suficiente para atravesar un especial que la habría matado. Su medidor es el más lento en cargarse, así que gástalo con intención.",
        "Thornwhip":
            "Látigo de Espinas",
        "Thunderstrike":
            "Golpe de Trueno",
        "Tiny, frantic, and never alone.":
            "Diminuto, frenético y nunca solo.",
        "Titan's Wrath":
            "Ira del Titán",
        "Umbral Reap":
            "Siega Umbría",
        "Yank the enemy in, cut them, and root them in place.":
            "Atrae al enemigo de un tirón, córtalo y enraízalo en el sitio.",
    },
    fr: {
        // ---- the shell -------------------------------------------------
        'Astral Clash': 'Astral Clash',
        'Dimensional Arena Fighter': 'Combats d’arène dimensionnels',
        'Play': 'Jouer',
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
        "Host's choice": 'Choix de l’hôte',
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
        'Player Colors': 'Couleurs des joueurs',
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
        "Couldn't load Three.js": 'Impossible de charger Three.js',
        'Do not show How to Play automatically next time':
            'Ne plus afficher « Comment jouer » automatiquement',
        "Don't show this automatically next time":
            'Ne plus afficher ceci automatiquement',
        'Your room code - share it with the other player':
            'Votre code de salon : partagez-le avec l’autre joueur',
        'Switch the two player colors to a colorblind-safe pair':
            'Remplace les deux couleurs de joueur par une paire adaptée au daltonisme',
        "The arena, drawn from your fighter's eyes. This game needs sight to play.":
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

        // ---- the last of them ------------------------------------------
        "; if you want to fight a bot or try the whole roster, turn on the \"Unlock everything\" sandbox in Settings — it leaves both players' real progress untouched and earns no coins.":
            "; si vous voulez affronter un bot ou essayer tout le roster, activez le bac à sable « Tout débloquer » dans les Réglages — il laisse la progression réelle des deux joueurs intacte et ne rapporte aucune pièce.",
        "Astral Clash is a first-person game, and a portrait screen puts both of your thumbs in the middle of the view.":
            "Astral Clash est un jeu à la première personne, et un écran en portrait place vos deux pouces au milieu de la vue.",
        "Difficulty: ‹ Normal ›":
            "Difficulté : ‹ Normal ›",
        "Keep your coins and unlocks on every device":
            "Gardez vos pièces et déblocages sur tous vos appareils",
        "Language of menus and help text":
            "Langue des menus et de l’aide",
        "Left thumb moves · drag to aim · tap to fire":
            "Pouce gauche pour bouger · glissez pour viser · touchez pour tirer",
        "Play Online":
            "Jouer en ligne",
        "Rotate to landscape":
            "Passez en mode paysage",
        "Send which fighter won, with nothing about you":
            "Envoie quel combattant a gagné, sans rien sur vous",
        "Share Stats":
            "Partager les stats",
        "Special attack":
            "Attaque spéciale",
        "Turn your phone sideways":
            "Tournez votre téléphone",
        "Your coins, unlocks and upgrades live on your account, not on this machine — sign in on any device and they are there.":
            "Vos pièces, déblocages et améliorations vivent sur votre compte, pas sur cette machine — connectez-vous sur n’importe quel appareil et ils y sont.",
        "Your opponent sees your choice in the room. Nothing starts until you press":
            "Votre adversaire voit votre choix dans le salon. Rien ne commence tant que vous n’appuyez pas sur",
        // ---- the split-screen build -------------------------------------
        "(keys on cards)":
            "(touches sur les cartes)",
        "Bot Fighter":
            "Combattant bot",
        "Choose your fighters":
            "Choisissez vos combattants",
        "Co-op: Boss & Survival":
            "Coop : Boss et Survie",
        "Pick a battleground, or drop into a random one.":
            "Choisissez un champ de bataille, ou lancez-en un au hasard.",
        "Play Again":
            "Rejouer",
        "Player 1 name":
            "Nom du Joueur 1",
        "Player 1 — Armory":
            "Joueur 1 — Armurerie",
        "Player 2 name":
            "Nom du Joueur 2",
        "Player 2 — Armory":
            "Joueur 2 — Armurerie",
        "Random (/)":
            "Aléatoire (/)",
        "Randomly chosen when the match starts":
            "Choisie au hasard au lancement du combat",
        "The longest melee reach in the game, but through a narrow cone — it is a line, not a sweep, so it needs to be aimed rather than swung in someone's general direction.":
            "La plus grande allonge au corps à corps du jeu, mais dans un cône étroit — c’est une ligne, pas un balayage : il faut la viser plutôt que l’agiter dans la direction générale de quelqu’un.",
        "Time Attack":
            "Course aux éliminations",
        "Titan's Wrath":
            "Courroux du Titan",
        "What are you playing for? You can change this any time before the match starts.":
            "Pour quoi jouez-vous ? Vous pouvez le changer à tout moment avant le début du combat.",
        "← Back to Fighters":
            "← Retour aux combattants",
        // ---- challenges, modes, and the rest of both builds -------------
        "Account":
            "Compte",
        "Armory":
            "Armurerie",
        "Back":
            "Retour",
        "Back to Online Version":
            "Retour à la version en ligne",
        "Best of 3 rounds. Knock your opponent out to win a round.":
            "Au meilleur des 3 manches. Mettez votre adversaire K.O. pour gagner une manche.",
        "Both players team up against Karrigos, the Granite Colossus. Its attacks are slow and telegraphed — punish the wind-up. Go down and you are out for 25 seconds; if your teammate falls while you are down, the run is over.":
            "Les deux joueurs font équipe contre Karrigos, le Colosse de Granit. Ses attaques sont lentes et télégraphiées — punissez la préparation. Si vous tombez, vous êtes hors jeu 25 secondes ; si votre équipier tombe pendant que vous êtes au sol, la partie est terminée.",
        "Clear a Survival Waves run with a teammate":
            "Terminez une partie de Vagues de survie avec un équipier",
        "Clears both players' coins, unlocks and upgrades on this machine. Names are kept. Click twice to confirm.":
            "Efface les pièces, déblocages et améliorations des deux joueurs sur cette machine. Les noms sont conservés. Cliquez deux fois pour confirmer.",
        "Coins":
            "Pièces",
        "Confirm":
            "Confirmer",
        "Continuous fight with instant respawns. First to 3 takedowns wins. No arena collapse — the race is the pressure.":
            "Combat continu avec réapparition immédiate. Le premier à 3 éliminations gagne. Pas d’effondrement de l’arène — la course est la pression.",
        "Controls":
            "Commandes",
        "Copy":
            "Copier",
        "Create account":
            "Créer un compte",
        "Damage":
            "Dégâts",
        "Dash":
            "Ruée",
        "Deal 400 damage in a single match":
            "Infligez 400 dégâts en un seul combat",
        "Details":
            "Détails",
        "Display name":
            "Nom affiché",
        "Email":
            "E-mail",
        "Forgotten your password?":
            "Mot de passe oublié ?",
        "Glow":
            "Lueur",
        "Health":
            "Santé",
        "Hold the glowing ring at the center. First to 45 seconds of control wins — knock them out of it.":
            "Tenez l’anneau lumineux au centre. Le premier à 45 secondes de contrôle gagne — délogez-l’en.",
        "Join":
            "Rejoindre",
        "Land a single hit for 60 damage or more":
            "Placez un seul coup à 60 dégâts ou plus",
        "Language":
            "Langue",
        "Main Attack":
            "Attaque principale",
        "Mute":
            "Muet",
        "New password":
            "Nouveau mot de passe",
        "Objective":
            "Objectif",
        "Password":
            "Mot de passe",
        "Player 1":
            "Joueur 1",
        "Player 2":
            "Joueur 2",
        "Quit to Menu":
            "Quitter vers le menu",
        "Rematch":
            "Revanche",
        "Reset Progress":
            "Réinitialiser la progression",
        "Resume":
            "Reprendre",
        "Retry":
            "Réessayer",
        "Save new password":
            "Enregistrer le nouveau mot de passe",
        "Send reset link":
            "Envoyer le lien de réinitialisation",
        "Settings":
            "Réglages",
        "Shield":
            "Bouclier",
        "Shop":
            "Boutique",
        "Sign in":
            "Se connecter",
        "Sign out":
            "Se déconnecter",
        "Sound":
            "Son",
        "Special":
            "Spéciale",
        "Speed":
            "Vitesse",
        "Team up and hold out against an endless run of ever-tougher challengers, one at a time. Coins for every wave cleared.":
            "Faites équipe et tenez bon contre une série sans fin d’adversaires toujours plus coriaces, un à la fois. Des pièces pour chaque vague franchie.",
        "Today’s Challenges":
            "Défis du jour",
        "Try every fighter and maxed-out upgrades without spending coins, and play against a bot. Each player's real progress is kept separately and comes back exactly as it was when you turn this off. Nothing you do in here earns coins — progression matches are two players, one keyboard.":
            "Essayez tous les combattants et toutes les améliorations au maximum sans dépenser de pièces, et jouez contre un bot. La progression réelle de chaque joueur est conservée à part et revient exactement comme elle était quand vous désactivez ceci. Rien de ce que vous faites ici ne rapporte de pièces — les combats de progression se jouent à deux sur un clavier.",
        "Unlock everything (sandbox)":
            "Tout débloquer (bac à sable)",
        "Use your Special three times in one match":
            "Utilisez votre Spéciale trois fois en un combat",
        "Username":
            "Nom d’utilisateur",
        "Win a Classic match 2-0":
            "Gagnez un combat Classique 2-0",
        "Win a Takedown Race":
            "Gagnez une Course aux éliminations",
        "Win a Zone Control match":
            "Gagnez un combat en Contrôle de zone",
        "Win a match after losing the first round":
            "Gagnez un combat après avoir perdu la première manche",
        "Win a match without using your Special":
            "Gagnez un combat sans utiliser votre Spéciale",
        "Win a round in under 20 seconds":
            "Gagnez une manche en moins de 20 secondes",
        "← Back to signing in":
            "← Retour à la connexion",
        // ---- the roster ------------------------------------------------
        "A balanced duelist with no bad matchup and no free win either. He wants to live at the edge of his own reach, trading slashes and using the dash to cross the gap or escape a corner.":
            "Un duelliste équilibré, sans mauvais match-up ni victoire offerte. Il veut vivre à la limite de sa propre allonge, en échangeant des taillades et en se servant de la ruée pour franchir l’écart ou sortir d’un coin.",
        "A blazing-fast glass cannon with the thinnest health of any melee fighter. He wins by never being where the last swing was — and the flurry is invulnerable, so it doubles as a way to run straight through an incoming attack.":
            "Un canon de verre fulgurant, avec la santé la plus fragile de tous les combattants au corps à corps. Il gagne en n’étant jamais là où le dernier coup est tombé — et la rafale est invulnérable, ce qui en fait aussi un moyen de traverser une attaque de plein fouet.",
        "A ground slam that launches the enemy away and stuns them.":
            "Un choc au sol qui projette l’ennemi au loin et l’étourdit.",
        "A heavy hammer swing through a narrow cone. Slow to start and slow to recover, so a whiff is a real punish — but it hits hard enough to be worth the risk.":
            "Un lourd coup de marteau dans un cône étroit. Lent à démarrer et lent à récupérer, donc un coup dans le vide se paie — mais il frappe assez fort pour valoir le risque.",
        "A long scythe sweep through a wide cone — more reach than any other melee basic except Thorne, and wide enough that a sidestep alone will not clear it.":
            "Un long balayage de faux dans un large cône — plus d’allonge que toute autre base au corps à corps sauf celle de Thorne, et assez large pour qu’un simple pas de côté ne suffise pas.",
        "A mountain that learned to move. Slow, enormous, and utterly unbothered.":
            "Une montagne qui a appris à marcher. Lent, énorme et parfaitement imperturbable.",
        "A quick sword arc through a wide cone in front of him. Short reach, but it recovers fast enough to throw out on reaction and keep throwing.":
            "Un arc d’épée rapide dans un large cône devant lui. Peu d’allonge, mais il récupère assez vite pour être sorti en réaction et resorti aussitôt.",
        "A ranged stormcaller who outranges everyone. Her special is the exception to everything else she does: it lands on the target directly rather than travelling, so it cannot be dodged or blocked by cover.":
            "Une invocatrice d’orages à distance qui surpasse l’allonge de tout le monde. Sa spéciale est l’exception à tout le reste : elle tombe directement sur la cible au lieu de voyager, donc elle ne peut être ni esquivée ni bloquée par un couvert.",
        "A rapid flurry jab with a very short cooldown. The least damage per hit on the roster, but you land far more of them than anyone else does.":
            "Un jab en rafale très rapide, au temps de recharge très court. Le plus faible dégât par coup du roster, mais vous en placez bien plus que quiconque.",
        "A relentless pressure fighter, fast on his feet and faster with his fists. The burst itself is modest — the burn afterwards is the real payload, and it keeps ticking while you keep jabbing.":
            "Un combattant de pression implacable, vif des pieds et plus vif encore des poings. L’explosion elle-même est modeste : la brûlure ensuite est la vraie charge, et elle continue pendant que vous continuez à frapper.",
        "A short shockwave that shoves you off.":
            "Une courte onde de choc qui vous repousse.",
        "A short-range overhead smash that hard-stuns (knocks down).":
            "Un coup vertical à courte portée qui étourdit lourdement (met à terre).",
        "A space-controller with the longest melee reach on the roster. He fights from a distance most characters consider safe, and the root buys him more than a second of free hits from exactly there.":
            "Un contrôleur d’espace avec la plus grande allonge au corps à corps du roster. Il combat à une distance que la plupart jugent sûre, et l’enracinement lui offre plus d’une seconde de coups gratuits depuis exactement là.",
        "A wide thorn-arc that ensnares (roots) the enemy in place.":
            "Un large arc d’épines qui entrave (enracine) l’ennemi sur place.",
        "Antlered Reaver":
            "Pillard Ramu",
        "Armoured but not immovable, and he builds special meter far faster than anyone else — so the knockdown comes around often. Use it to reset a fight you are losing, not just for the damage.":
            "Cuirassé mais pas inamovible, et il charge sa jauge spéciale bien plus vite que quiconque — donc la mise à terre revient souvent. Servez-vous-en pour relancer un combat mal engagé, pas seulement pour les dégâts.",
        "Ashen Mortar":
            "Mortier Cendreux",
        "Astral Orb":
            "Orbe Astral",
        "Astral Ward":
            "Garde Astrale",
        "Bastion Knight":
            "Chevalier Bastion",
        "Blade Dash":
            "Ruée de Lame",
        "Blink onto the enemy and stab rapidly, briefly invulnerable.":
            "Clignez jusqu’à l’ennemi et poignardez rapidement, brièvement invulnérable.",
        "Bramble Lash":
            "Cinglée de Ronces",
        "Call a bolt down directly onto the enemy — cannot be sidestepped.":
            "Appelez un éclair directement sur l’ennemi — impossible à esquiver sur le côté.",
        "Cinder Pugilist":
            "Pugiliste de Braise",
        "Cinder Spray":
            "Gerbe de Braises",
        "Cowled Harvester":
            "Moissonneur Encapuchonné",
        "Cycles between a shockwave Ground Slam, a telegraphed Charge, and an Ember Nova spread.":
            "Alterne entre un Brise-Sol à onde de choc, une Charge télégraphiée et une gerbe de Nova de Braises.",
        "Darts through its target.":
            "Fonce à travers sa cible.",
        "Dash through the enemy, cutting them on the pass and ending behind them.":
            "Traversez l’ennemi d’une ruée, en le tranchant au passage et en finissant derrière lui.",
        "Ember Jab":
            "Jab de Braise",
        "Erupt in flame, leaving the enemy burning over time.":
            "Explosez en flammes, laissant l’ennemi brûler dans la durée.",
        "Fires a single fast shard in a straight line. Long range, but it is a real projectile — it can miss, and it can be sidestepped or blocked by cover.":
            "Tire un unique éclat rapide en ligne droite. Longue portée, mais c’est un vrai projectile — il peut manquer, et il peut être esquivé sur le côté ou bloqué par un couvert.",
        "Flicker Cutthroat":
            "Égorgeur Fugace",
        "Forge Hammerfist":
            "Poing-Marteau de Forge",
        "Fragile and deadly at range. She loses any melee exchange she is dragged into, so the whole game is keeping the gap open — the volley is as much a wall as it is damage.":
            "Fragile et mortelle à distance. Elle perd tout échange au corps à corps dans lequel on la traîne, donc tout le jeu consiste à garder l’écart ouvert : la volée est autant un mur qu’un dégât.",
        "Gaunt Wraith":
            "Spectre Décharné",
        "Glass Shard":
            "Éclat de Verre",
        "Granite Colossus":
            "Colosse de Granit",
        "Ground Breaker":
            "Brise-Sol",
        "Haloed Aegis":
            "Égide Nimbée",
        "Hangs back and lobs fire. Punish it for existing.":
            "Reste en retrait et lance du feu. Punissez-le d’exister.",
        "Inferno Burst":
            "Explosion Infernale",
        "Ironclad Smash":
            "Fracas Cuirassé",
        "Lobs a slow-building orb of light down a long, narrow line. Low damage per shot — it is chip damage meant to be applied constantly from a safe distance.":
            "Lance un orbe de lumière à montée lente sur une ligne longue et étroite. Peu de dégâts par tir — c’est du grignotage, à appliquer sans relâche depuis une distance sûre.",
        "Long reach that drags foes into the blade. The special pulls a runaway opponent from well outside her range and roots them there, which turns a fleeing ranged fighter into a free follow-up.":
            "Une grande allonge qui traîne les ennemis jusqu’à la lame. La spéciale tire un adversaire en fuite depuis bien au-delà de sa portée et l’enracine sur place, ce qui transforme un tireur qui s’échappe en enchaînement gratuit.",
        "Prism Volley":
            "Volée Prismatique",
        "Quickstab":
            "Estoc Rapide",
        "Raise a strong shield that halves incoming damage for several seconds.":
            "Levez un bouclier solide qui divise par deux les dégâts subis pendant plusieurs secondes.",
        "Rhythm Slash":
            "Taillade Rythmée",
        "Scrap Gremlin":
            "Gremlin de Ferraille",
        "Seismic Slam":
            "Choc Sismique",
        "Shadow Flurry":
            "Rafale d’Ombres",
        "Shardwing Sylph":
            "Sylphide Aile-d’Éclat",
        "Skitter":
            "Trottinement",
        "Slow, heavy, and unbothered by your first few hits.":
            "Lent, lourd, et indifférent à vos premiers coups.",
        "Spits a fan of molten shards.":
            "Crache un éventail d’éclats en fusion.",
        "Spray a wide 5-shard fan to wall off space.":
            "Projetez un large éventail de 5 éclats pour barrer l’espace.",
        "Storm Bolt":
            "Éclair d’Orage",
        "Stormcrown Valkyrie":
            "Valkyrie Couronne-Orage",
        "Tectonic Brute":
            "Brute Tectonique",
        "Tempo Duelist":
            "Duelliste de Tempo",
        "The fastest basic in the game — a near-instant dagger poke with almost no recovery. The reach is the shortest in the game, so you have to be genuinely on top of someone.":
            "La base la plus rapide du jeu — un coup de dague quasi instantané, sans presque aucune récupération. L’allonge est la plus courte du jeu : il faut être vraiment collé à l’adversaire.",
        "The hardest-hitting basic on the roster, and by far the most committal — a long wind-up and a long recovery. Two of these end most fights; two whiffs end yours.":
            "La base la plus puissante du roster, et de loin la plus engageante : une longue préparation et une longue récupération. Deux de celles-ci terminent la plupart des combats ; deux coups dans le vide terminent le vôtre.",
        "The largest health pool in the game, on the slowest fighter in it. He cannot chase anyone, so he wins by making the space directly in front of him unaffordable to stand in — and the slam clears that space again whenever someone gets comfortable.":
            "La plus grande réserve de santé du jeu, sur le combattant le plus lent qui soit. Il ne peut poursuivre personne, alors il gagne en rendant intenable l’espace juste devant lui — et le choc dégage cet espace dès que quelqu’un s’y installe.",
        "The longest melee reach in the game, but through a narrow cone — it is a line, not a sweep, so it needs to be aimed rather than swung in someone's general direction.":
            "La plus grande allonge au corps à corps du jeu, mais dans un cône étroit — c’est une ligne, pas un balayage : il faut la viser plutôt que l’agiter dans la direction générale de quelqu’un.",
        "The longest-range basic in the game: a fast bolt down a very tight line. It demands real aim — the cone is the narrowest on the roster and it is still a dodgeable projectile.":
            "La base avec la plus grande portée du jeu : un éclair rapide sur une ligne très serrée. Elle exige une vraie visée — le cône est le plus étroit du roster et cela reste un projectile esquivable.",
        "The only fighter whose special deals no damage at all. She survives instead of trading: the ward halves everything for over three seconds, which is long enough to walk through a special that would have killed her. Her meter builds slowest, so spend it deliberately.":
            "La seule combattante dont la spéciale n’inflige aucun dégât. Elle survit au lieu d’échanger : la garde divise tout par deux pendant plus de trois secondes, assez pour traverser une spéciale qui l’aurait tuée. Sa jauge se remplit le plus lentement, alors dépensez-la à bon escient.",
        "Thornwhip":
            "Fouet d’Épines",
        "Thunderstrike":
            "Frappe de Tonnerre",
        "Tiny, frantic, and never alone.":
            "Minuscule, frénétique, et jamais seul.",
        "Titan's Wrath":
            "Courroux du Titan",
        "Umbral Reap":
            "Fauche Ombreuse",
        "Yank the enemy in, cut them, and root them in place.":
            "Tirez l’ennemi à vous, tranchez-le et enracinez-le sur place.",
    },
};

// Prose blocks, keyed by their whole innerHTML. See the note at the top: a
// paragraph that wraps phrases in <b> has FRAGMENTS for text nodes, and no
// language keeps English's word order, so these are translated entire.
const I18N_HTML = {
    es: {
        // ---- the split-screen build -------------------------------------
        "Each player has their own coins, unlocks and upgrades. You both start with three fighters; the rest are bought with coins earned from matches — the winner takes more, but a loss still pays something. Coins also buy permanent per-fighter upgrades to Health, Damage, Special charge rate, and Speed, plus Double Jump. Open the Armory from your own panel (or the footer) and use the Player 1 / Player 2 tabs. Progression matches are two players; if you want to fight a bot or try the whole roster, turn on the \"Unlock everything\" sandbox in Settings — it leaves both players' real progress untouched and earns no coins.":
            "<b>Cada jugador tiene sus propias monedas, desbloqueos y mejoras.</b> Los dos empezáis con tres luchadores; el resto se compran con monedas ganadas en los combates: el ganador se lleva más, pero una derrota también paga algo. Las monedas compran además mejoras permanentes por luchador de Salud, Daño, velocidad de carga del Especial y Velocidad, más el Salto doble. Abre la Armería desde tu propio panel (o desde el pie) y usa las pestañas de Jugador 1 / Jugador 2. Los combates de progresión son de <b>dos jugadores</b>; si quieres luchar contra un bot o probar todo el elenco, activa el modo de pruebas «Desbloquear todo» en Ajustes: deja intacto el progreso real de ambos jugadores y no da monedas.",
        "Movement is covered under Controls above. Jumping reaches platforms and cover, but has a cooldown afterward — you can't spam it. Steps with a small enough rise are walkable without jumping; tall ledges and walls aren't. Use columns and interior walls for cover. Buy Double Jump in the Armory and you can press jump again in mid-air, once per airborne stretch, to reach the tallest perches.":
            "El movimiento se explica en <b>Controles</b>, más arriba. Saltar alcanza plataformas y coberturas, pero tiene un tiempo de recarga después: no puedes abusar de él. Los escalones de poca altura se pueden caminar sin saltar; los salientes altos y los muros, no. Usa las columnas y los muros interiores como cobertura. Compra el <b>Salto doble</b> en la Armería y podrás volver a saltar en el aire, una vez por cada tramo aéreo, para llegar a las cornisas más altas.",
        "Pick a mode from the button under the title. Classic Versus is best of 3 rounds. Zone Control puts a glowing ring at the arena's centre — stand in it alone to bank control time, and knock your opponent out of it; first to 45 seconds wins. Time Attack is one continuous fight with instant respawns, first to 3 knockouts. In the two continuous modes a knockout costs you tempo, not the match. The last two modes are co-op — see the card beside this one.":
            "Elige un modo con el botón bajo el título. <b>Versus clásico</b> es al mejor de 3 rondas. <b>Control de zona</b> coloca un anillo luminoso en el centro de la arena: quédate dentro <em>a solas</em> para acumular tiempo de control y echa de él a tu rival; gana el primero que llegue a 45 segundos. <b>Carrera de derribos</b> es un combate continuo con reapariciones instantáneas, el primero en lograr 3 derribos. En los dos modos continuos, caer te cuesta ritmo, no el combate. Los dos últimos modos son cooperativos: mira la tarjeta de al lado.",
        "Survival Waves sends squads of lesser creatures at you — darting Grint, fire-spitting Slagling, and heavy Hollowkin — with more of them each wave. Clear a wave to bank coins and recover 30% of your health. Every 5th wave is a Karrigos boss wave instead. In both modes the run ends the moment either of you falls, so keep each other alive; the Bot difficulty setting scales everything.":
            "<b>Oleadas de supervivencia</b> te lanza escuadrones de criaturas menores: Grint veloces, Slagling escupefuego y Hollowkin pesados, y cada oleada trae más. Supera una oleada para embolsarte monedas y recuperar el <b>30% de tu salud</b>. Cada <b>5.ª oleada</b> es, en su lugar, una oleada de jefe con Karrigos. En ambos modos la partida termina en cuanto <b>cualquiera de los dos</b> cae, así que manteneos con vida; el ajuste de dificultad del Bot escala todo.",
        "Two co-op modes put you and Player 2 on the same team. Boss Fight pits you against Karrigos, the Granite Colossus — enormous, slow, and enormously strong. Every one of its attacks has a long, obvious wind-up: a shockwave Ground Slam, a Charge at whoever's closest, and an Ember Nova spread. Watch the tell, get clear, then punish the recovery.":
            "Dos modos cooperativos te ponen a ti y al Jugador 2 en el <b>mismo equipo</b>. <b>Jefe</b> te enfrenta a Karrigos, el Coloso de Granito: enorme, lento y enormemente fuerte. Todos sus ataques tienen una preparación larga y evidente: un Rompesuelos de onda expansiva, una Carga contra quien esté más cerca y una dispersión de Nova de Brasas. Observa la señal, apártate y castiga la recuperación.",
        "You fight through your character's own eyes, weapon in hand. See Controls above for how you move and aim. Separate look up/down keys aim vertically, and ranged attacks fire along that aim — so you can shoot up at someone on a high perch, or down at the floor from one. On a gamepad the right stick looks. Two human players share the screen split left/right; against a bot you get the whole screen.":
            "Luchas a través de los ojos de tu personaje, con el arma en la mano. Consulta <b>Controles</b> más arriba para saber cómo te mueves y apuntas. Las teclas de <b>mirar arriba/abajo</b> apuntan en vertical, y los ataques a distancia disparan siguiendo esa puntería, así que puedes disparar hacia arriba a alguien en una plataforma alta, o hacia abajo desde una. En un mando, el stick derecho mira. Dos jugadores humanos comparten la pantalla dividida izquierda/derecha; contra un bot tienes la pantalla entera.",
        "Astral Clash is played with a mouse to aim and a keyboard to move, so it needs a desktop or laptop. Open it there and you are set.":
            "Astral Clash se juega con un <b>ratón para apuntar</b> y un <b>teclado para moverse</b>, así que necesita un ordenador de sobremesa o portátil. Ábrelo ahí y listo.",

        "Best of 3 rounds. Win a round by knocking your opponent's HP to 0 — there's no clock to just run out, so see Arena Collapse below for how a round is guaranteed to end.":
            "Al mejor de 3 rondas. Ganas una ronda dejando los PV de tu rival a 0: no hay reloj que se agote, así que consulta «Derrumbe de la arena» más abajo para ver cómo se garantiza el final de una ronda.",

        "Every match is two people on two machines. One of you presses Play → Host Game and reads out the room code; the other pastes it into Join. You both land in the room, where you each pick your own fighter — you can only pick yours, and you'll see theirs appear as they choose.":
            "Cada combate es <b>dos personas en dos máquinas</b>. Uno de los dos pulsa <b>Jugar → Crear partida</b> y lee en voz alta el código de sala; el otro lo pega en <b>Unirse</b>. Los dos entráis en la <b>sala</b>, donde cada uno elige su propio luchador: solo puedes elegir el tuyo, y verás aparecer el del otro a medida que elige.",

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
        // ---- the split-screen build -------------------------------------
        "Each player has their own coins, unlocks and upgrades. You both start with three fighters; the rest are bought with coins earned from matches — the winner takes more, but a loss still pays something. Coins also buy permanent per-fighter upgrades to Health, Damage, Special charge rate, and Speed, plus Double Jump. Open the Armory from your own panel (or the footer) and use the Player 1 / Player 2 tabs. Progression matches are two players; if you want to fight a bot or try the whole roster, turn on the \"Unlock everything\" sandbox in Settings — it leaves both players' real progress untouched and earns no coins.":
            "<b>Chaque joueur a ses propres pièces, déblocages et améliorations.</b> Vous commencez tous les deux avec trois combattants ; les autres s’achètent avec les pièces gagnées en combat : le vainqueur en prend plus, mais une défaite rapporte quand même quelque chose. Les pièces achètent aussi des améliorations permanentes par combattant pour la Santé, les Dégâts, la vitesse de charge de la Spéciale et la Vitesse, ainsi que le Double saut. Ouvrez l’Armurerie depuis votre propre panneau (ou le pied de page) et utilisez les onglets Joueur 1 / Joueur 2. Les combats de progression se jouent à <b>deux joueurs</b> ; si vous voulez affronter un bot ou essayer tout le roster, activez le bac à sable « Tout débloquer » dans les Réglages — il laisse la progression réelle des deux joueurs intacte et ne rapporte aucune pièce.",
        "Movement is covered under Controls above. Jumping reaches platforms and cover, but has a cooldown afterward — you can't spam it. Steps with a small enough rise are walkable without jumping; tall ledges and walls aren't. Use columns and interior walls for cover. Buy Double Jump in the Armory and you can press jump again in mid-air, once per airborne stretch, to reach the tallest perches.":
            "Le déplacement est expliqué sous <b>Commandes</b>, plus haut. Le saut atteint les plateformes et les couverts, mais a ensuite un temps de recharge : impossible de l’enchaîner. Les marches assez basses se franchissent à pied ; les rebords hauts et les murs non. Servez-vous des colonnes et des murs intérieurs comme couvert. Achetez le <b>Double saut</b> à l’Armurerie et vous pourrez sauter une seconde fois en plein air, une fois par envol, pour atteindre les perchoirs les plus hauts.",
        "Pick a mode from the button under the title. Classic Versus is best of 3 rounds. Zone Control puts a glowing ring at the arena's centre — stand in it alone to bank control time, and knock your opponent out of it; first to 45 seconds wins. Time Attack is one continuous fight with instant respawns, first to 3 knockouts. In the two continuous modes a knockout costs you tempo, not the match. The last two modes are co-op — see the card beside this one.":
            "Choisissez un mode avec le bouton sous le titre. <b>Versus classique</b> se joue au meilleur des 3 manches. <b>Contrôle de zone</b> place un anneau lumineux au centre de l’arène : tenez-vous-y <em>seul</em> pour accumuler du temps de contrôle et délogez-en votre adversaire ; le premier à 45 secondes gagne. <b>Course aux éliminations</b> est un combat continu avec réapparition immédiate, le premier à 3 éliminations. Dans ces deux modes continus, se faire sortir coûte du tempo, pas le combat. Les deux derniers modes sont coopératifs — voyez la carte à côté.",
        "Survival Waves sends squads of lesser creatures at you — darting Grint, fire-spitting Slagling, and heavy Hollowkin — with more of them each wave. Clear a wave to bank coins and recover 30% of your health. Every 5th wave is a Karrigos boss wave instead. In both modes the run ends the moment either of you falls, so keep each other alive; the Bot difficulty setting scales everything.":
            "<b>Vagues de survie</b> vous envoie des escouades de créatures mineures : des Grint véloces, des Slagling cracheurs de feu et de lourds Hollowkin, et chaque vague en apporte davantage. Franchissez une vague pour empocher des pièces et récupérer <b>30 % de votre santé</b>. Toutes les <b>5 vagues</b>, c’est une vague de boss avec Karrigos. Dans les deux modes, la partie s’arrête dès que <b>l’un de vous</b> tombe : gardez-vous mutuellement en vie ; le réglage de difficulté du Bot ajuste tout.",
        "Two co-op modes put you and Player 2 on the same team. Boss Fight pits you against Karrigos, the Granite Colossus — enormous, slow, and enormously strong. Every one of its attacks has a long, obvious wind-up: a shockwave Ground Slam, a Charge at whoever's closest, and an Ember Nova spread. Watch the tell, get clear, then punish the recovery.":
            "Deux modes coopératifs vous placent, vous et le Joueur 2, dans la <b>même équipe</b>. <b>Boss</b> vous oppose à Karrigos, le Colosse de Granit : énorme, lent et énormément fort. Chacune de ses attaques a une préparation longue et évidente : un Brise-Sol à onde de choc, une Charge sur le plus proche, et une gerbe de Nova de Braises. Guettez le signe, dégagez-vous, puis punissez la récupération.",
        "You fight through your character's own eyes, weapon in hand. See Controls above for how you move and aim. Separate look up/down keys aim vertically, and ranged attacks fire along that aim — so you can shoot up at someone on a high perch, or down at the floor from one. On a gamepad the right stick looks. Two human players share the screen split left/right; against a bot you get the whole screen.":
            "Vous combattez par les yeux de votre personnage, arme en main. Voyez <b>Commandes</b> plus haut pour vous déplacer et viser. Les touches <b>regarder haut/bas</b> visent à la verticale, et les attaques à distance tirent le long de cette visée : vous pouvez donc tirer vers le haut sur quelqu’un perché, ou vers le bas depuis un perchoir. À la manette, le stick droit regarde. Deux joueurs humains partagent l’écran divisé gauche/droite ; contre un bot, vous avez l’écran entier.",
        "Astral Clash is played with a mouse to aim and a keyboard to move, so it needs a desktop or laptop. Open it there and you are set.":
            "Astral Clash se joue avec une <b>souris pour viser</b> et un <b>clavier pour se déplacer</b> : il lui faut donc un ordinateur de bureau ou portable. Ouvrez-le là et c’est bon.",

        "Best of 3 rounds. Win a round by knocking your opponent's HP to 0 — there's no clock to just run out, so see Arena Collapse below for how a round is guaranteed to end.":
            "Au meilleur des 3 manches. Vous gagnez une manche en réduisant les PV de votre adversaire à 0 : aucun chronomètre ne vient l'interrompre, voyez donc « Effondrement de l'arène » plus bas pour savoir comment une manche finit forcément.",

        "Every match is two people on two machines. One of you presses Play → Host Game and reads out the room code; the other pastes it into Join. You both land in the room, where you each pick your own fighter — you can only pick yours, and you'll see theirs appear as they choose.":
            "Chaque combat se joue à <b>deux personnes sur deux machines</b>. L'un de vous appuie sur <b>Jouer → Héberger</b> et lit le code du salon à voix haute ; l'autre le colle dans <b>Rejoindre</b>. Vous arrivez tous les deux dans le <b>salon</b>, où chacun choisit son propre combattant : vous ne pouvez choisir que le vôtre, et vous verrez le sien apparaître au fur et à mesure.",

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

// Kept for the keyboard and gamepad paths, which step through a setting rather
// than open a menu. The settings row itself is a <select> now: three languages
// is already too many to reach by pressing until the one you want comes round.
function cycleLang() {
    const at = AC_LANGS.findIndex(l => l.id === curLang());
    setLang(AC_LANGS[(at + 1) % AC_LANGS.length].id);
}

function langLabel() {
    const l = AC_LANGS.find(x => x.id === curLang());
    return l ? l.label : 'English';
}

function refreshLangUI() {
    const sel = document.getElementById('sel-lang');
    if (!sel) return;
    // Rebuilt rather than written once at startup: AC_LANGS is the list, and a
    // control populated from it cannot fall out of step with it.
    if (sel.options.length !== AC_LANGS.length) {
        sel.innerHTML = AC_LANGS
            .map(l => '<option value="' + l.id + '">' + l.label + '</option>').join('');
    }
    sel.value = curLang();
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
