// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! STEP/IFC Parser using nom
//!
//! Zero-copy tokenization and fast entity scanning.

use nom::{
    branch::alt,
    bytes::complete::{tag, take_while, take_while1},
    character::complete::{char, digit1, one_of},
    combinator::{map, map_res, opt, recognize},
    multi::{many0, separated_list0},
    sequence::{delimited, pair, preceded, tuple},
    IResult,
};

use crate::error::{Error, Result};
use crate::schema::IfcType;

/// STEP/IFC Token
#[derive(Debug, Clone, PartialEq)]
pub enum Token<'a> {
    /// Entity reference: #123
    EntityRef(u32),
    /// String literal: 'text'
    String(&'a str),
    /// Integer: 42
    Integer(i64),
    /// Float: 3.14
    Float(f64),
    /// Enum: .TRUE., .FALSE., .UNKNOWN.
    Enum(&'a str),
    /// List: (1, 2, 3)
    List(Vec<Token<'a>>),
    /// Typed value: IFCPARAMETERVALUE(0.), IFCBOOLEAN(.T.)
    TypedValue(&'a str, Vec<Token<'a>>),
    /// Null value: $
    Null,
    /// Asterisk (derived value): *
    Derived,
}

/// Parse entity reference: #123
fn entity_ref(input: &str) -> IResult<&str, Token> {
    map(
        preceded(
            char('#'),
            map_res(digit1, |s: &str| s.parse::<u32>())
        ),
        Token::EntityRef
    )(input)
}

/// Parse string literal: 'text' or "text"
/// IFC uses '' to escape a single quote within a string
fn string_literal(input: &str) -> IResult<&str, Token> {
    // Helper to parse string content with escaped quotes
    fn parse_string_content(input: &str, quote: char) -> IResult<&str, &str> {
        let mut i = 0;
        let bytes = input.as_bytes();

        while i < bytes.len() {
            if bytes[i] as char == quote {
                // Check if it's an escaped quote (doubled)
                if i + 1 < bytes.len() && bytes[i + 1] as char == quote {
                    i += 2; // Skip both quotes
                    continue;
                } else {
                    // End of string
                    return Ok((&input[i..], &input[..i]));
                }
            }
            i += 1;
        }

        // No closing quote found
        Err(nom::Err::Error(nom::error::Error::new(input, nom::error::ErrorKind::Char)))
    }

    alt((
        map(
            delimited(
                char('\''),
                |i| parse_string_content(i, '\''),
                char('\'')
            ),
            Token::String
        ),
        map(
            delimited(
                char('"'),
                |i| parse_string_content(i, '"'),
                char('"')
            ),
            Token::String
        ),
    ))(input)
}

/// Parse integer: 42, -42
/// Uses lexical-core for 10x faster parsing
#[inline]
fn integer(input: &str) -> IResult<&str, Token> {
    map_res(
        recognize(
            tuple((
                opt(char('-')),
                digit1,
            ))
        ),
        |s: &str| lexical_core::parse::<i64>(s.as_bytes())
            .map(Token::Integer)
            .map_err(|_| "parse error")
    )(input)
}

/// Parse float: 3.14, -3.14, 1.5E-10, 0., 1.
/// IFC allows floats like "0." without decimal digits
/// Uses lexical-core for 10x faster parsing
#[inline]
fn float(input: &str) -> IResult<&str, Token> {
    map_res(
        recognize(
            tuple((
                opt(char('-')),
                digit1,
                char('.'),
                opt(digit1),  // Made optional to support "0." format
                opt(tuple((
                    one_of("eE"),
                    opt(one_of("+-")),
                    digit1,
                ))),
            ))
        ),
        |s: &str| lexical_core::parse::<f64>(s.as_bytes())
            .map(Token::Float)
            .map_err(|_| "parse error")
    )(input)
}

/// Parse enum: .TRUE., .FALSE., .UNKNOWN., .ELEMENT.
fn enum_value(input: &str) -> IResult<&str, Token> {
    map(
        delimited(
            char('.'),
            take_while1(|c: char| c.is_alphanumeric() || c == '_'),
            char('.')
        ),
        Token::Enum
    )(input)
}

/// Parse null: $
fn null(input: &str) -> IResult<&str, Token> {
    map(char('$'), |_| Token::Null)(input)
}

/// Parse derived: *
fn derived(input: &str) -> IResult<&str, Token> {
    map(char('*'), |_| Token::Derived)(input)
}

/// Parse typed value: IFCPARAMETERVALUE(0.), IFCBOOLEAN(.T.)
fn typed_value(input: &str) -> IResult<&str, Token> {
    map(
        pair(
            // Type name (all caps with optional numbers/underscores)
            take_while1(|c: char| c.is_alphanumeric() || c == '_'),
            // Arguments
            delimited(
                char('('),
                separated_list0(
                    delimited(ws, char(','), ws),
                    token
                ),
                char(')')
            )
        ),
        |(type_name, args)| Token::TypedValue(type_name, args)
    )(input)
}

/// Skip whitespace
fn ws(input: &str) -> IResult<&str, ()> {
    map(
        take_while(|c: char| c.is_whitespace()),
        |_| ()
    )(input)
}

/// Parse a token with optional surrounding whitespace
fn token(input: &str) -> IResult<&str, Token> {
    delimited(
        ws,
        alt((
            float,        // Try float before integer (float includes '.')
            integer,
            entity_ref,
            string_literal,
            enum_value,
            list,
            typed_value,  // IFCPARAMETERVALUE(0.), IFCBOOLEAN(.T.), etc.
            null,
            derived,
        )),
        ws
    )(input)
}

/// Parse list: (1, 2, 3) or nested lists
fn list(input: &str) -> IResult<&str, Token> {
    map(
        delimited(
            char('('),
            separated_list0(
                delimited(ws, char(','), ws),
                token
            ),
            char(')')
        ),
        Token::List
    )(input)
}

/// Parse a complete entity line
/// Example: #123=IFCWALL('guid','owner',$,$,'name',$,$,$);
pub fn parse_entity(input: &str) -> Result<(u32, IfcType, Vec<Token>)> {
    let result: IResult<&str, (u32, &str, Vec<Token>)> = tuple((
        // Entity ID: #123
        delimited(
            ws,
            preceded(
                char('#'),
                map_res(digit1, |s: &str| s.parse::<u32>())
            ),
            ws
        ),
        // Equals sign
        preceded(
            char('='),
            // Entity type: IFCWALL
            delimited(
                ws,
                take_while1(|c: char| c.is_alphanumeric() || c == '_'),
                ws
            )
        ),
        // Arguments: ('guid', 'owner', ...)
        delimited(
            char('('),
            separated_list0(
                delimited(ws, char(','), ws),
                token
            ),
            tuple((char(')'), ws, char(';')))
        ),
    ))(input);

    match result {
        Ok((_, (id, type_str, args))) => {
            let ifc_type = IfcType::from_str(type_str)
                .ok_or_else(|| Error::InvalidIfcType(type_str.to_string()))?;
            Ok((id, ifc_type, args))
        }
        Err(e) => Err(Error::parse(0, format!("Failed to parse entity: {}", e))),
    }
}

/// Fast entity scanner - scans file without full parsing
/// O(n) performance for finding entities by type
/// Uses memchr for SIMD-accelerated byte searching
pub struct EntityScanner<'a> {
    content: &'a str,
    bytes: &'a [u8],
    position: usize,
}

impl<'a> EntityScanner<'a> {
    /// Create a new scanner
    pub fn new(content: &'a str) -> Self {
        Self {
            content,
            bytes: content.as_bytes(),
            position: 0,
        }
    }

    /// Scan for the next entity
    /// Returns (entity_id, type_name, line_start, line_end)
    #[inline]
    pub fn next_entity(&mut self) -> Option<(u32, &'a str, usize, usize)> {
        let remaining = &self.bytes[self.position..];

        // Find next '#' that starts an entity using SIMD-accelerated search
        let start_offset = memchr::memchr(b'#', remaining)?;
        let line_start = self.position + start_offset;

        // Find the end of the line (semicolon) using SIMD
        let line_content = &self.bytes[line_start..];
        let end_offset = memchr::memchr(b';', line_content)?;
        let line_end = line_start + end_offset + 1;

        // Parse entity ID (inline for speed)
        let id_start = line_start + 1;
        let mut id_end = id_start;
        while id_end < line_end && self.bytes[id_end].is_ascii_digit() {
            id_end += 1;
        }

        // Fast integer parsing without allocation
        let id = self.parse_u32_fast(id_start, id_end)?;

        // Find '=' after ID using SIMD
        let eq_search = &self.bytes[id_end..line_end];
        let eq_offset = memchr::memchr(b'=', eq_search)?;
        let mut type_start = id_end + eq_offset + 1;

        // Skip whitespace (inline)
        while type_start < line_end && self.bytes[type_start].is_ascii_whitespace() {
            type_start += 1;
        }

        // Find end of type name (at '(' or whitespace)
        let mut type_end = type_start;
        while type_end < line_end {
            let b = self.bytes[type_end];
            if b == b'(' || b.is_ascii_whitespace() {
                break;
            }
            type_end += 1;
        }

        // Safe because IFC files are ASCII
        let type_name = unsafe { std::str::from_utf8_unchecked(&self.bytes[type_start..type_end]) };

        // Move position past this entity
        self.position = line_end;

        Some((id, type_name, line_start, line_end))
    }

    /// Fast u32 parsing without string allocation
    #[inline]
    fn parse_u32_fast(&self, start: usize, end: usize) -> Option<u32> {
        let mut result: u32 = 0;
        for i in start..end {
            let digit = self.bytes[i].wrapping_sub(b'0');
            if digit > 9 {
                return None;
            }
            result = result.wrapping_mul(10).wrapping_add(digit as u32);
        }
        Some(result)
    }

    /// Find all entities of a specific type
    pub fn find_by_type(&mut self, target_type: &str) -> Vec<(u32, usize, usize)> {
        let mut results = Vec::new();

        while let Some((id, type_name, start, end)) = self.next_entity() {
            if type_name.eq_ignore_ascii_case(target_type) {
                results.push((id, start, end));
            }
        }

        results
    }

    /// Count entities by type
    pub fn count_by_type(&mut self) -> rustc_hash::FxHashMap<String, usize> {
        let mut counts = rustc_hash::FxHashMap::default();

        while let Some((_, type_name, _, _)) = self.next_entity() {
            *counts.entry(type_name.to_string()).or_insert(0) += 1;
        }

        counts
    }

    /// Reset scanner to beginning
    pub fn reset(&mut self) {
        self.position = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_entity_ref() {
        assert_eq!(entity_ref("#123"), Ok(("", Token::EntityRef(123))));
        assert_eq!(entity_ref("#0"), Ok(("", Token::EntityRef(0))));
    }

    #[test]
    fn test_string_literal() {
        assert_eq!(string_literal("'hello'"), Ok(("", Token::String("hello"))));
        assert_eq!(string_literal("'with spaces'"), Ok(("", Token::String("with spaces"))));
    }

    #[test]
    fn test_integer() {
        assert_eq!(integer("42"), Ok(("", Token::Integer(42))));
        assert_eq!(integer("-42"), Ok(("", Token::Integer(-42))));
        assert_eq!(integer("0"), Ok(("", Token::Integer(0))));
    }

    #[test]
    fn test_float() {
        assert_eq!(float("3.14"), Ok(("", Token::Float(3.14))));
        assert_eq!(float("-3.14"), Ok(("", Token::Float(-3.14))));
        assert_eq!(float("1.5E-10"), Ok(("", Token::Float(1.5e-10))));
    }

    #[test]
    fn test_enum() {
        assert_eq!(enum_value(".TRUE."), Ok(("", Token::Enum("TRUE"))));
        assert_eq!(enum_value(".FALSE."), Ok(("", Token::Enum("FALSE"))));
        assert_eq!(enum_value(".ELEMENT."), Ok(("", Token::Enum("ELEMENT"))));
    }

    #[test]
    fn test_list() {
        let result = list("(1,2,3)");
        assert!(result.is_ok());
        let (_, token) = result.unwrap();
        match token {
            Token::List(items) => {
                assert_eq!(items.len(), 3);
                assert_eq!(items[0], Token::Integer(1));
                assert_eq!(items[1], Token::Integer(2));
                assert_eq!(items[2], Token::Integer(3));
            }
            _ => panic!("Expected List token"),
        }
    }

    #[test]
    fn test_nested_list() {
        let result = list("(1,(2,3),4)");
        assert!(result.is_ok());
        let (_, token) = result.unwrap();
        match token {
            Token::List(items) => {
                assert_eq!(items.len(), 3);
                assert_eq!(items[0], Token::Integer(1));
                match &items[1] {
                    Token::List(inner) => {
                        assert_eq!(inner.len(), 2);
                        assert_eq!(inner[0], Token::Integer(2));
                        assert_eq!(inner[1], Token::Integer(3));
                    }
                    _ => panic!("Expected nested List"),
                }
                assert_eq!(items[2], Token::Integer(4));
            }
            _ => panic!("Expected List token"),
        }
    }

    #[test]
    fn test_parse_entity() {
        let input = "#123=IFCWALL('guid','owner',$,$,'name',$,$,$);";
        let result = parse_entity(input);
        assert!(result.is_ok());
        let (id, ifc_type, args) = result.unwrap();
        assert_eq!(id, 123);
        assert_eq!(ifc_type, IfcType::IfcWall);
        assert_eq!(args.len(), 8);
    }

    #[test]
    fn test_parse_entity_with_nested_list() {
        // First test: simple list (should work)
        let simple = "(0.,0.,1.)";
        println!("Testing simple list: {}", simple);
        let simple_result = list(simple);
        println!("Simple list result: {:?}", simple_result);

        // Second test: nested in entity (what's failing)
        let input = "#9=IFCDIRECTION((0.,0.,1.));";
        println!("\nTesting full entity: {}", input);
        let result = parse_entity(input);

        if let Err(ref e) = result {
            println!("Parse error: {:?}", e);

            // Try parsing just the arguments part
            println!("\nTrying to parse just arguments: ((0.,0.,1.))");
            let args_input = "((0.,0.,1.))";
            let args_result = list(args_input);
            println!("Args list result: {:?}", args_result);
        }

        assert!(result.is_ok(), "Failed to parse: {:?}", result);
        let (id, _ifc_type, args) = result.unwrap();
        assert_eq!(id, 9);
        assert_eq!(args.len(), 1);
        // First arg should be a list containing 3 floats
        if let Token::List(inner) = &args[0] {
            assert_eq!(inner.len(), 3);
        } else {
            panic!("Expected Token::List, got {:?}", args[0]);
        }
    }

    #[test]
    fn test_entity_scanner() {
        let content = r#"
#1=IFCPROJECT('guid',$,$,$,$,$,$,$,$);
#2=IFCWALL('guid2',$,$,$,$,$,$,$);
#3=IFCDOOR('guid3',$,$,$,$,$,$,$);
#4=IFCWALL('guid4',$,$,$,$,$,$,$);
"#;

        let mut scanner = EntityScanner::new(content);

        // Test next_entity
        let (id, type_name, _, _) = scanner.next_entity().unwrap();
        assert_eq!(id, 1);
        assert_eq!(type_name, "IFCPROJECT");

        // Test find_by_type
        scanner.reset();
        let walls = scanner.find_by_type("IFCWALL");
        assert_eq!(walls.len(), 2);
        assert_eq!(walls[0].0, 2);
        assert_eq!(walls[1].0, 4);

        // Test count_by_type
        scanner.reset();
        let counts = scanner.count_by_type();
        assert_eq!(counts.get("IFCPROJECT"), Some(&1));
        assert_eq!(counts.get("IFCWALL"), Some(&2));
        assert_eq!(counts.get("IFCDOOR"), Some(&1));
    }
}
