// Revoke the previous chat's visible state synchronously, before any database read.
export function createChatViewController({getScope,setLogScope,clearInjection,resetWorld,closeReaders,switchEditor,renderEmpty}) {
 let previous=Symbol('unbound');
 return {sync(){const scope=getScope();if(scope===previous)return false;previous=scope;
  setLogScope(scope);clearInjection();resetWorld();closeReaders();switchEditor();renderEmpty();return true;
 }};
}
