// Barrel for the OAuth HTTP handlers sub-module. Each handler is an
// Effect that takes parsed inputs and returns a HandlerResponse;
// main.ts adapts the response to a Node ServerResponse.

export * from "./handleAuthorize";
export * from "./handleAuthorizationServerMetadata";
export * from "./handleGoogleCallback";
export * from "./handleJwks";
export * from "./handleProtectedResourceMetadata";
export * from "./handleRegister";
export * from "./handleToken";
