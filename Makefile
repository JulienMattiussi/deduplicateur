.PHONY: help install start build lint typecheck check-rust test test-rust test-ts clean

help: ## Afficher les commandes disponibles
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Installer les dépendances npm
	npm install

start: ## Lancer l'application en développement (hot reload)
	. "$$HOME/.cargo/env" && npm run tauri dev

build: ## Compiler l'exécutable de production
	. "$$HOME/.cargo/env" && npm run tauri build

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
