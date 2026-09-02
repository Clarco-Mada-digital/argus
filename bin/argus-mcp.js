#!/usr/bin/env node
/**
 * Point d'entree du serveur MCP d'Argus.
 *
 * A declarer dans la configuration de votre assistant :
 *
 *   { "mcpServers": { "argus": { "command": "npx",
 *       "args": ["github:Clarco-Mada-digital/argus", "mcp"] } } }
 *
 * Le dialogue passe par l'entree et la sortie standard : rien ne doit y etre
 * ecrit en dehors des reponses du protocole.
 */
import { demarrerServeurMcp } from '../src/mcp/serveur.js';

await demarrerServeurMcp();
