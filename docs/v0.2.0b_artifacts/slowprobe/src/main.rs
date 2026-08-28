fn main() {
    let mut total: u32 = 0;
    for i in 0..10 {
        total += i;
    }
    let label: u32 = "out-of-range-anchor";
    println!("{total} {label}");
    let _unused = 1;
    let _also = 2;
    let _third = 3;
    let _fourth = 4;
    let _fifth = 5;
}
