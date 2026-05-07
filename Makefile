.PHONY: help install start build build-light build-full build-msi build-deb build-appimage download-fpcalc download-ffmpeg lint typecheck check-rust test test-rust test-ts clean

help: ## Afficher les commandes disponibles
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Installer les dépendances npm
	npm install

start: ## Lancer l'application en développement (hot reload)
	. "$$HOME/.cargo/env" && npm run tauri dev

build: build-light ## Compiler l'exécutable de production (alias build-light)

build-light: ## Build light - aucun binaire bundlé (fpcalc/ffmpeg fournis par le système)
	. "$$HOME/.cargo/env" && npm run build:light

build-full: download-fpcalc download-ffmpeg ## Build full - fpcalc + ffmpeg + ffprobe bundlés (Linux/Windows)
	. "$$HOME/.cargo/env" && npm run build:full

build-msi: ## Générer uniquement le MSI Windows (à lancer sur Windows)
	. "$$HOME/.cargo/env" && npm run build:light -- --bundles msi

build-deb: ## Générer uniquement le paquet .deb Linux
	. "$$HOME/.cargo/env" && npm run build:light -- --bundles deb

build-appimage: ## Générer uniquement l'AppImage Linux
	. "$$HOME/.cargo/env" && npm run build:light -- --bundles appimage

download-fpcalc: ## Télécharger fpcalc pour la plateforme courante
	bash scripts/download-fpcalc.sh

download-ffmpeg: ## Télécharger ffmpeg + ffprobe pour la plateforme courante
	bash scripts/download-ffmpeg.sh

lint: ## Vérifier le code TypeScript avec ESLint
	npm run lint

typecheck: ## Vérifier les types TypeScript
	npx tsc --noEmit

check-rust: ## Vérifier la compilation Rust sans produire de binaire
	cd src-tauri && . "$$HOME/.cargo/env" && cargo check

test: test-rust test-ts ## Lancer tous les tests

test-rust: ## Lancer les tests Rust du moteur de déduplication
	cd src-tauri && . "$$HOME/.cargo/env" && cargo test

test-ts: ## Lancer les tests TypeScript des utilitaires
	npm run test

clean: ## Supprimer les artefacts de build
	rm -rf dist
	rm -rf src-tauri/target
