// Frases prediseñadas por categoría (§4.3). El filtrado es 100% cliente.

export const CATEGORIES = [
  { id: 'all', label: 'Todos' },
  { id: 'saludos', label: 'Saludos' },
  { id: 'viajes', label: 'Viajes' },
  { id: 'comida', label: 'Comida' },
  { id: 'compras', label: 'Compras' },
  { id: 'utiles', label: 'Útiles' },
];

export const PHRASES = [
  // Saludos
  { cat: 'saludos', de: 'Guten Morgen!', es: 'Buenos días' },
  { cat: 'saludos', de: 'Wie geht es Ihnen?', es: '¿Cómo está usted?' },
  { cat: 'saludos', de: 'Schön, dich kennenzulernen.', es: 'Encantado de conocerte' },
  { cat: 'saludos', de: 'Bis später!', es: 'Hasta luego' },

  // Viajes
  { cat: 'viajes', de: 'Wo ist der Bahnhof?', es: '¿Dónde está la estación?' },
  { cat: 'viajes', de: 'Eine Fahrkarte nach Berlin, bitte.', es: 'Un billete a Berlín, por favor' },
  { cat: 'viajes', de: 'Wann fährt der nächste Zug ab?', es: '¿Cuándo sale el próximo tren?' },
  { cat: 'viajes', de: 'Ich habe ein Zimmer reserviert.', es: 'He reservado una habitación' },

  // Comida
  { cat: 'comida', de: 'Die Speisekarte, bitte.', es: 'La carta, por favor' },
  { cat: 'comida', de: 'Ich hätte gern ein Wasser.', es: 'Quisiera un agua' },
  { cat: 'comida', de: 'Die Rechnung, bitte.', es: 'La cuenta, por favor' },
  { cat: 'comida', de: 'Das schmeckt sehr gut!', es: '¡Está muy rico!' },

  // Compras
  { cat: 'compras', de: 'Wie viel kostet das?', es: '¿Cuánto cuesta esto?' },
  { cat: 'compras', de: 'Kann ich mit Karte zahlen?', es: '¿Puedo pagar con tarjeta?' },
  { cat: 'compras', de: 'Ich schaue mich nur um.', es: 'Solo estoy mirando' },
  { cat: 'compras', de: 'Haben Sie das in einer anderen Größe?', es: '¿Lo tienen en otra talla?' },

  // Útiles
  { cat: 'utiles', de: 'Ich verstehe nicht.', es: 'No entiendo' },
  { cat: 'utiles', de: 'Können Sie das bitte wiederholen?', es: '¿Puede repetirlo, por favor?' },
  { cat: 'utiles', de: 'Sprechen Sie Englisch?', es: '¿Habla usted inglés?' },
  { cat: 'utiles', de: 'Ich brauche Hilfe.', es: 'Necesito ayuda' },
];
