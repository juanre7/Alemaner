// Configuracion publica del frontend.
// apiBaseUrl vacio mantiene el comportamiento automatico:
// - en localhost usa el proxy local (/api/analyze)
// - en GitHub Pages llama directamente al proveedor con la clave BYOK
window.ALEMANER_CONFIG = {
  apiBaseUrl: '',
  directProvider: 'openrouter',
  directModel: 'deepseek/deepseek-v4-flash',
};
