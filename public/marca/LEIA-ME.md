# Marca SENAI

Arquivos oficiais da identidade visual do SENAI, baixados do repositório de
marcas do Sistema Indústria:

<https://sistemaindustria.portaldaindustria.com.br/manual-de-marcas>

| Arquivo | Origem | Uso |
|---|---|---|
| `senai.svg` | `senai_original_pdf.zip` → `SENAI_sem_assinatura_cor.pdf` | Versão colorida, fundo claro |
| `senai-negativa.svg` | `senai_negativa_pdf.zip` → `SENAI_sem_assinatura_negativa.pdf` | Versão branca, fundo escuro |
| `senai.png` | `senai_original_png.zip` | Reserva para contextos sem SVG (e-mail, exportações) |

Os SVG foram convertidos do PDF vetorial oficial com `pdftocairo -svg`, sem
redesenho: as curvas são exatamente as do arquivo original.

## Cores

Extraídas do próprio arquivo oficial, não estimadas:

| Cor | Hex | Onde |
|---|---|---|
| Azul SENAI | `#0F4194` | Cor institucional principal |
| Laranja SENAI | `#E84B11` | Acento — o pingo do "i", símbolo da indústria |

Estão declaradas como `--color-senai-*` e `--color-acento-*` em
`app/globals.css` e usadas em toda a interface.

## Regras de aplicação

Vindas do manual de marcas do Sistema Indústria:

- **Não distorça.** O componente `<Logo>` (`src/components/brand/logo.tsx`)
  preserva a proporção 436×110; use as alturas que ele oferece.
- **Respeite a área de proteção.** O componente já reserva a margem mínima ao
  redor da marca.
- **Não recolora.** Sobre fundo escuro use `variante="negativa"`, nunca o azul
  com filtro.
- **Não use como ícone.** Para o favicon e para a barra do navegador existe o
  símbolo isolado; a marca completa é um wordmark horizontal.

## Trocar pela marca da unidade

Se a sua unidade usar a assinatura regional (SENAI/SC com o bloco FIESC), basta
substituir `senai.svg` e `senai-negativa.svg` mantendo os mesmos nomes. Nenhum
código precisa mudar — o `<Logo>` lê daqui.

Versões com assinatura (`senai_*_ass_*.zip`) e as marcas de SESI, IEL e CNI
estão no mesmo repositório oficial citado acima.
