package converter

import (
	md "github.com/JohannesKaufmann/html-to-markdown/v2"
)

func HTMLToMarkdown(html string) (string, error) {
	return md.ConvertString(html)
}
