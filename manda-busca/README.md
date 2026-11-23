# MANDA BUSCA

Simulador 3D de combate de pipas em primeira pessoa, direto no navegador (TypeScript, Vite e Three.js/WebGL2).
Um jogador contra bots, sem nenhum arquivo de áudio, textura ou modelo externo: tudo é gerado por código.

## Como rodar

```bash
cd manda-busca
npm install
npm run dev        # servidor de desenvolvimento
npm run typecheck  # tsc --noEmit
npm run build      # build de produção em dist/
npm test           # testes (vitest)
```

Parâmetros de URL úteis para teste: `?map=bairro|praia|montanha`, `sky=manha|tarde|noite`,
`mode=bairro|duelo|matamata|ranqueado`, `diff=iniciante|criado-na-laje|mestre-do-relo`, `bots=N`,
`champ=primeiro,intervalo,preparacao,corrida` (encurta o Campeonato do Bairro), `autostart=1` e `debug=1`
(expõe `window.__game`).

## Controles

| Tecla | Ação |
|-------|------|
| W A S D, mouse | andar e olhar |
| N ou clique | soltar a pipa (com a pipa perdida, pede uma nova) |
| Clique esquerdo | desbicada |
| Q / E | inclinar o nariz da pipa para a esquerda / direita |
| Botão direito (segurar) | dar linha |
| Botão direito + cliques rápidos | tapa (tenteio) |
| Scroll para baixo ou Shift | puxada rápida |
| R (segurar) | recolher a linha ou encher o carretel |
| F ou Ctrl | zoom óptico (75° para 20°) |
| B / M | equipamento / missões |
| E perto da porta da loja | loja Valdir Pipas (Bairro Livre) |
| C | replay do último corte (1, 2, 3 trocam 0,25x, 0,5x, 1x) |
| L / U | liga e desliga rótulos das pipas / som |
| T | mais um bot (Bairro Livre, até 8) |
| 1, 2, 3 | céu: manhã, fim de tarde, noite |
| F3 / Esc | estatísticas / menu |

## Modos de jogo

- **Bairro Livre**: cenário aberto com até 8 bots, loja, missões diárias e semanais e o Campeonato do Bairro
  a cada 3 minutos (20 s de preparação sem corte e 60 s valendo; quem sobrevive ganha moedas e, a cada 3 vitórias, uma skin).
- **Duelo 1x1**: arena dividida por uma linha no chão, melhor de 5 cortes contra um bot de dificuldade escolhida.
- **Mata-Mata 3x3 ou 4x4**: sem fogo amigo, pipas infinitas, vence o primeiro time a 50 cortes.
- **Ranqueado 1x1**: o rival acompanha a sua patente (Mirin, Rabeiro, Chocão III, II e I, Lenda do Bairro);
  vitória vale +25 RP e derrota -15 RP.

## Como funciona

- Física em passo fixo de 60 Hz; o combate roda a 240 Hz efetivos (4 sub-passos).
- Linha de 36 nós (XPBD com solução tridiagonal e sub-passos adaptativos), pipa como corpo rígido com
  aerodinâmica de placa plana, rabiola e estirante.
- Corte no relo: o desgaste vai para a linha de menor poder de corte (velocidade da linha vezes a abrasividade),
  com pico de potência nas desbicadas. O estirante e a rabiola cortam por contato (6 cm).
- Bots (`src/entities/KiteAI.ts`) usam os mesmos comandos do jogador: sobem a pipa, conduzem a própria linha até
  cruzar a do inimigo, serram alternando puxar e dar linha, e tentam aparar avoadas.
- `src/game/Simulation.ts` junta IA, combate, recompensas e regras do modo e roda sem navegador (os testes usam isso).

```text
src/
  core/      laço fixo, entrada, áudio procedural, ruído, carretel
  physics/   vento, linha, pipa, relo, mundo de combate
  world/     céu, mapas (Bairro, Praia, Montanha), mãos em primeira pessoa, texturas
  entities/  malhas da pipa e da linha, efeitos, KiteAI
  game/      Simulation, modos, campeonato, arena, replay, recompensas
  data/      catálogo (7 pipas, 3 carretéis, 3 linhas, 4 skins) e perfil/economia
  ui/        HUD, menu, garagem (equipamento, loja, missões, classificação), rótulos
```

## Limites conhecidos

- O visual é procedural e estilizado, não fotorrealista: mãos tipo manequim, árvores de poucos polígonos.
- Os testes automatizados rodam em Node e em Chromium com WebGL por software: o desempenho em GPU real
  e o travamento de ponteiro (pointer lock) não foram medidos.
- A subida assistida leva cerca de 25 a 30 s para chegar a ~24 m de altura.
- Os bots raramente conseguem aparar uma avoada: ela cai de ~17 m para ~3 m em cerca de 15 s e o servo
  da caça nem sempre chega a tempo.
- O perfil fica só no `localStorage` do navegador; a tabela de classificação tem rivais fixos, não jogadores reais.
