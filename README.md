# Affiche Studio

Générateur d'affiches assisté par IA. Vous importez vos images, vous décrivez le brief, et l'application écrit une affiche **en HTML/CSS** — pas une image générée — puis l'exporte en PNG haute résolution.

![Affiche Studio](docs/screenshot.png)

## Pourquoi

Les générateurs d'images produisent des visuels impossibles à retoucher. Affiche Studio produit du code : chaque titre, chaque marge, chaque couleur reste modifiable, et le rendu final est net à n'importe quelle taille.

## Fonctionnalités (v2.1)

- Éditeur de **calques** : texte, image, forme, déplacement, redimensionnement, rotation
- Affiche au centre, projets à gauche, chat IA + calques + style à droite
- Thèmes sombre/clair avec accents (violet `#7C3AED` par défaut) et palettes d'affiche
- Interface **FR / EN / ES** à chaud
- Formats en sélecteur visuel : réseaux sociaux, impression, web, personnalisé
- Backend **API compatible OpenAI** ou **OpenCode local** (CLI)
- Templates, palette de commandes (Ctrl/Cmd+K), duplication, groupes, versions, undo/redo
- Export **PNG ×1/×2**, **PDF** et **HTML** autonome
- Page **Compte** avec vérification et installation des mises à jour GitHub
- **Chat humain** : bulles, avatars, horodatage, indicateur de réflexion animé,
  étapes, copier/réessayer, suggestions, rendu markdown léger
- Icônes SVG cohérentes, animations, mode clair/sombre, mode réduit
- Menu contextuel du canvas, copier/coller, alignement multi-calques
- Clé API optionnellement mémorisée (fichier de configuration en `0600`)

## Backend OpenCode local

Si l'API d'inférence renvoie `402` alors que l'abonnement OpenCode fonctionne,
choisis **OpenCode local** dans les réglages :

- Fournisseur : `OpenCode local`
- Modèle : `opencode-go/deepseek-v4.1-flash`
- Effort : `low`

L'app lance `opencode run --format json --agent plan --model
"opencode-go/deepseek-v4.1-flash#low"` et lit la réponse. Aucune clé API n'est
nécessaire : la CLI utilise la session OpenCode déjà connectée. L'agent `plan`
est en lecture seule.

## Mises à jour

La page **Compte** vérifie les releases GitHub (canal stable) et affiche la
version installée, les notes de version et un bouton de mise à jour.

- **AppImage** : installation automatique signée (Tauri updater).
- **`.deb`**, **Windows**, **macOS** : l'app propose le téléchargement de la
  release ; macOS nécessitera une signature Apple pour l'auto-update.
- Les releases doivent être **publiées** (pas en draft) et contenir
  `latest.json` + les paquets signés.
- Secrets GitHub requis : `TAURI_SIGNING_PRIVATE_KEY` et
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. La clé publique est dans
  `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).

## Configuration API

L'application fonctionne avec tout endpoint compatible OpenAI :

| Fournisseur | Base URL | Exemple de modèle |
|---|---|---|
| OpenCode Console / Go | `https://opencode.ai/inference/openai/v1` | `deepseek-v4.1-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| OpenRouter | `https://openrouter.ai/api/v1` | `anthropic/claude-3.5-sonnet` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Ollama | `http://localhost:11434/v1` | `qwen2.5-coder:32b` | `ollama` (non vide) |

Une clé peut aussi être fournie par variable d'environnement : `AFFICHE_STUDIO_API_KEY` ou `OPENAI_API_KEY`.

Pour **OpenCode + DeepSeek V4.1 Flash**, choisissez l'effort de raisonnement **`low`**
dans les réglages : l'application envoie alors `reasoning_effort: "low"`.
L'export fonctionne aussi avec les modèles sans raisonnement (laissez « Défaut »).

## Export PNG

Le rendu PNG passe par un navigateur Chromium en mode headless. Il faut donc que **Google Chrome, Chromium, Microsoft Edge ou Brave** soit installé sur la machine. L'application détecte automatiquement le navigateur ; en cas d'échec, l'export HTML reste disponible.

## Développement

Prérequis : Rust ≥ 1.77, Node ≥ 18, et les dépendances Tauri
(`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev` sur Debian/Ubuntu).

```bash
npm install
npm run dev      # lance l'app en dev
npm run build    # bundles dans src-tauri/target/release/bundle
```

Le frontend est en HTML/CSS/JS pur, sans bundler : `dist/` est servi tel quel par Tauri.

## Distribution

La v2 ignore volontairement les projets HTML de la v1 : ils ne sont pas listés
dans l'interface.

Le workflow `.github/workflows/release.yml` construit, sur tag `v*` :

- **Linux** : `.deb`, `.AppImage`, `.rpm` (via Tauri)
- **Windows** : `.msi`, `.exe` (NSIS)
- **macOS** : `.dmg` et `.zip`, universel Intel + Apple Silicon
- **Flatpak** : `affiche-studio.flatpak` (job séparé, à valider au premier release)

Créer un release :

```bash
git tag v0.1.0
git push origin v0.1.0
```

> Les builds Windows et macOS se font sur les runners GitHub Actions : compiler un `.exe` ou un `.dmg` depuis Linux n'est pas fiable.

## Sécurité

- La clé API n'est jamais incluse dans les projets exportés.
- Si « Mémoriser la clé » est coché, elle est écrite dans le dossier de configuration de l'application avec des permissions `0600` (Unix). Sinon elle reste en mémoire pour la session.
- Les projets sont stockés dans le dossier de données de l'application, jamais envoyés ailleurs qu'à l'API que vous configurez.

## Licence

MIT — voir [LICENSE](LICENSE).
